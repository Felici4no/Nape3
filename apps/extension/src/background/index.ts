import { planPurchase } from "@nape3/agent";
import type { CartQuoteObservation, MarketObservation } from "@nape3/domain";
import { acaiFixtures } from "@nape3/fixtures";
import { compareCheckout, summarizeMarket, type MarketSummary } from "@nape3/market";
import { createLogger, errorMessage } from "../shared/log";
import { mergeObservation, requirementFromObservation, snapshotToObservation } from "../shared/observation";
import {
  DEFAULT_SETTINGS,
  type ExtensionMessage,
  type ExtensionResponse,
  type ExtensionSettings,
  type MarketView,
  type PageSnapshot
} from "../shared/types";

const log = createLogger("background");
const MAX_OBSERVATIONS = 300;

// --------------------------------------------------------------------------
// Local storage (this browser only)
// --------------------------------------------------------------------------

async function getSettings(): Promise<ExtensionSettings> {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings as Partial<ExtensionSettings> | undefined) };
}

/** Random per-install id. Not derived from, or linked to, any platform account. */
async function getObserverId(): Promise<string> {
  const { observerId } = await chrome.storage.local.get("observerId");
  if (typeof observerId === "string") return observerId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ observerId: id });
  return id;
}

async function getObservations(): Promise<MarketObservation[]> {
  const { observations } = await chrome.storage.local.get("observations");
  return Array.isArray(observations) ? (observations as MarketObservation[]) : [];
}

async function saveObservation(observation: CartQuoteObservation): Promise<number> {
  const { next, superseded } = mergeObservation(await getObservations(), observation, MAX_OBSERVATIONS);
  await chrome.storage.local.set({ observations: next });
  return superseded.length;
}

/**
 * Debounced messages can arrive out of order. Per tab, a snapshot older than
 * the newest one already processed is ignored.
 */
const latestCaptureByTab = new Map<number, number>();
function isOutOfOrder(snapshot: PageSnapshot, tabId: number | undefined): boolean {
  if (tabId === undefined) return false;
  const at = Date.parse(snapshot.capturedAt);
  const latest = latestCaptureByTab.get(tabId) ?? 0;
  if (at < latest) return true;
  latestCaptureByTab.set(tabId, at);
  return false;
}

async function uploadObservation(observation: MarketObservation, settings: ExtensionSettings) {
  if (!settings.networkEndpoint) return;
  try {
    const response = await fetch(new URL("/v1/observations", settings.networkEndpoint), {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "omit",
      body: JSON.stringify(observation)
    });
    log.info("observation.uploaded", { status: response.status, id: observation.id });
  } catch (error) {
    log.warn("observation.upload_failed", { error: errorMessage(error) });
  }
}

/** Market data = this browser's real observations (+ synthetic fixtures if enabled, flagged). */
async function marketData(settings: ExtensionSettings, now: Date): Promise<MarketObservation[]> {
  const own = await getObservations();
  return settings.includeFixtures ? [...own, ...acaiFixtures(now)] : own;
}

const EMPTY_SUMMARY: MarketSummary = summarizeMarket([], {
  requirement: { category: "acai" },
  quantity: 1,
  now: new Date(0)
});

async function handleRecord(snapshot: PageSnapshot, tabId: number | undefined): Promise<MarketView> {
  if (isOutOfOrder(snapshot, tabId)) {
    log.info("snapshot.out_of_order_ignored", { snapshotId: snapshot.snapshotId, capturedAt: snapshot.capturedAt });
    return { summary: EMPTY_SUMMARY, comparison: null, observation: null, notRecordedReason: "older snapshot ignored (page changed since)" };
  }
  const settings = await getSettings();
  const observerId = await getObserverId();
  const built = snapshotToObservation(snapshot, settings, observerId);
  if (!built.ok) {
    log.info("observation.not_recorded", {
      snapshotId: snapshot.snapshotId,
      capturedAt: snapshot.capturedAt,
      context: snapshot.detection.context,
      reason: built.reason
    });
    return { summary: EMPTY_SUMMARY, comparison: null, observation: null, notRecordedReason: built.reason };
  }
  const observation = built.observation;
  const superseded = await saveObservation(observation);
  log.info("observation.recorded", {
    id: observation.id,
    snapshotId: snapshot.snapshotId,
    observedAt: observation.observedAt,
    stage: observation.quote.stage,
    quantity: observation.quote.lines.reduce((sum, line) => sum + line.quantity, 0),
    totalCents: observation.quote.totalCents,
    supersededPreviousStates: superseded
  });
  void uploadObservation(observation, settings);

  const target = requirementFromObservation(observation);
  if (!target) {
    return {
      summary: EMPTY_SUMMARY,
      comparison: null,
      observation,
      notRecordedReason: "recorded, but the cart is not a single supported product (only açaí with a known volume is compared)"
    };
  }
  const now = new Date();
  const summary = summarizeMarket(await marketData(settings, now), {
    ...target,
    now,
    provenance: settings.includeFixtures ? "include-synthetic" : "real-only",
    ...(settings.marketRegion ? { marketRegion: settings.marketRegion } : {}),
    excludeIds: [observation.id]
  });
  return { summary, comparison: compareCheckout(observation.quote.totalCents, summary), observation, notRecordedReason: null };
}

async function handlePlan(request: string, snapshot: PageSnapshot | null): Promise<ExtensionResponse> {
  const settings = await getSettings();
  const observerId = await getObserverId();
  const now = new Date();
  // Only a validated checkout is given to the decision engine.
  const current = snapshot?.cart ? snapshotToObservation(snapshot, settings, observerId) : null;
  const plan = planPurchase(request, await marketData(settings, now), {
    now,
    policy: {
      provenance: settings.includeFixtures ? "include-synthetic" : "real-only",
      observerId,
      ...(settings.marketRegion ? { marketRegion: settings.marketRegion } : {})
    },
    ...(current?.ok ? { currentCheckout: current.observation } : {})
  });
  log.info("agent.planned", { state: plan.agent.state, status: plan.decision?.status ?? null });
  return {
    ok: true,
    type: "PLAN",
    decision: plan.decision,
    intentError: plan.intent.ok ? null : plan.intent.reason,
    agentState: plan.agent.state,
    notes: plan.intent.ok ? [...plan.intent.intent.parsing.notes, ...plan.intent.intent.parsing.missing.map((m) => `missing: ${m}`)] : [],
    currentCheckout: current?.ok
      ? { used: true, reason: null }
      : { used: false, reason: current ? current.reason : "no checkout on this page" }
  };
}

async function handle(message: ExtensionMessage, tabId: number | undefined): Promise<ExtensionResponse> {
  switch (message.type) {
    case "RECORD_SNAPSHOT":
      return { ok: true, type: "MARKET", market: await handleRecord(message.snapshot, tabId) };
    case "PLAN_INTENT":
      return handlePlan(message.request, message.snapshot);
    case "GET_SETTINGS":
      return { ok: true, type: "SETTINGS", settings: await getSettings() };
    case "SAVE_SETTINGS":
      await chrome.storage.local.set({ settings: message.settings });
      return { ok: true, type: "SETTINGS", settings: await getSettings() };
    case "CLEAR_OBSERVATIONS":
      await chrome.storage.local.set({ observations: [] });
      return { ok: true, type: "DONE" };
    case "GET_SNAPSHOT":
    case "GET_DOM_CAPTURE":
      return { ok: false, error: "handled by the content script" };
    default:
      return { ok: false, error: `unsupported message ${(message as { type: string }).type}` };
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse: (r: ExtensionResponse) => void) => {
  if (message.type === "GET_SNAPSHOT" || message.type === "GET_DOM_CAPTURE") return false; // content script
  // Messages from the popup carry the tab id explicitly; content scripts via sender.
  const tabId = message.type === "RECORD_SNAPSHOT" ? (message.tabId ?? sender.tab?.id) : sender.tab?.id;
  handle(message, tabId)
    .then(sendResponse)
    .catch((error: unknown) => {
      log.error("message.failed", { type: message.type, error: errorMessage(error) });
      sendResponse({ ok: false, error: errorMessage(error) });
    });
  return true; // async response
});
