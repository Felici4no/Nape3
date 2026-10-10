import { adviseFromMenus, planPurchase, type MenuObservation } from "@nape3/agent";
import type { CartQuoteObservation, MarketObservation } from "@nape3/domain";
import { acaiFixtures } from "@nape3/fixtures";
import { compareCheckout, summarizeMarket, type MarketSummary } from "@nape3/market";
import { createLogger, errorMessage } from "../shared/log";
import { executorHealth, executorIdentity, scheduleExecutor } from "./executor";
import { isAllowedPayOrigin, parseWalletReport, payability, type PendingPayment, type WalletStatus } from "../shared/payment";
import { mergeNetworkObservations } from "../shared/network";
import { mergeObservation, requirementFromObservation, snapshotToObservation } from "../shared/observation";
import {
  DEFAULT_SETTINGS,
  type BridgeStatus,
  type ConnectivityReport,
  type DevSnapshotPayload,
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

const NETWORK_CACHE_MS = 60_000;
let networkCache: { endpoint: string; at: number; observations: unknown[] } | null = null;

/** Recent real observations from the observer network (cached for a minute; empty on any failure). */
async function networkObservations(settings: ExtensionSettings, now: Date): Promise<unknown[]> {
  const endpoint = settings.networkEndpoint;
  if (!endpoint) return [];
  if (networkCache && networkCache.endpoint === endpoint && now.getTime() - networkCache.at < NETWORK_CACHE_MS) return networkCache.observations;
  try {
    const url = new URL("/v1/observations", endpoint);
    url.searchParams.set("sinceMinutes", String(7 * 24 * 60));
    const response = await fetch(url, {
      credentials: "omit",
      headers: settings.networkReadToken ? { authorization: `Bearer ${settings.networkReadToken}` } : {},
      signal: AbortSignal.timeout(4_000)
    });
    if (!response.ok) {
      log.warn("network.read_failed", { status: response.status });
      return [];
    }
    const body = (await response.json()) as { observations?: unknown };
    const observations = Array.isArray(body.observations) ? body.observations : [];
    networkCache = { endpoint, at: now.getTime(), observations };
    return observations;
  } catch (error) {
    log.warn("network.read_failed", { error: errorMessage(error) });
    return [];
  }
}

/**
 * Market data = this browser's real observations + the observer network's
 * real observations (when an endpoint is set). Synthetic fixtures are added
 * only when the user explicitly enables them, and are then flagged.
 */
async function marketData(settings: ExtensionSettings, now: Date): Promise<MarketObservation[]> {
  const own = await getObservations();
  const { observations, dropped } = mergeNetworkObservations(own, await networkObservations(settings, now));
  if (dropped > 0) log.warn("network.dropped", { dropped });
  return settings.includeFixtures ? [...observations, ...acaiFixtures(now)] : observations;
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
      notRecordedReason: "recorded, but the cart is not a single supported product (açaí by volume, pizza by size, sushi by pieces, burger)"
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

// --------------------------------------------------------------------------
// Menus read on restaurant pages (local only, 24 h, at most 60 shops)
// --------------------------------------------------------------------------

const MENU_TTL_MS = 24 * 60 * 60_000;
const MAX_MENUS = 60;

async function getMenus(now = Date.now()): Promise<MenuObservation[]> {
  const { menus } = (await chrome.storage.local.get("menus")) as { menus?: MenuObservation[] };
  return (menus ?? []).filter((m) => now - Date.parse(m.observedAt) <= MENU_TTL_MS);
}

async function recordMenu(menu: MenuObservation): Promise<ExtensionResponse> {
  const settings = await getSettings();
  const entry: MenuObservation = { ...menu, ...(settings.marketRegion ? { marketRegion: settings.marketRegion } : {}) };
  const key = (m: MenuObservation) => m.merchant.platformId ?? m.merchant.name;
  const menus = [entry, ...(await getMenus()).filter((m) => key(m) !== key(entry))].slice(0, MAX_MENUS);
  await chrome.storage.local.set({ menus });
  log.info("menu.recorded", { merchant: entry.merchant.name, items: entry.items.length, shops: menus.length });
  return { ok: true, type: "DONE" };
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
  const menuAdvice = plan.intent.ok
    ? adviseFromMenus(plan.intent.intent, await getMenus(now.getTime()), { now, ...(settings.marketRegion ? { marketRegion: settings.marketRegion } : {}) })
    : null;
  // The agent's pick is outlined on that shop's page (content/highlight.ts).
  const pick = menuAdvice?.bestForRequest ?? menuAdvice?.nearest ?? null;
  await chrome.storage.local.set({
    recommended: pick
      ? { merchantKey: pick.merchantPath ?? pick.merchantName, title: pick.title, priceCents: pick.priceCents, estimatedTotalCents: pick.estimatedTotalCents, at: now.toISOString() }
      : null
  });
  log.info("agent.planned", { state: plan.agent.state, status: plan.decision?.status ?? null, menuItems: menuAdvice?.itemsConsidered ?? 0 });
  return {
    ok: true,
    type: "PLAN",
    decision: plan.decision,
    intentError: plan.intent.ok ? null : plan.intent.reason,
    agentState: plan.agent.state,
    notes: plan.intent.ok ? [...plan.intent.intent.parsing.notes, ...plan.intent.intent.parsing.missing.map((m) => `missing: ${m}`)] : [],
    currentCheckout: current?.ok
      ? { used: true, reason: null }
      : { used: false, reason: current ? current.reason : "no checkout on this page" },
    menuAdvice
  };
}

// --------------------------------------------------------------------------
// Crypto payment: pending payment (session storage) + wallet status bridge
// --------------------------------------------------------------------------

const PAYMENT_TTL_MS = 15 * 60_000;

async function createPayment(snapshot: PageSnapshot): Promise<ExtensionResponse> {
  const pay = payability(snapshot);
  if (!pay.payable) return { ok: false, error: `cannot pay: ${pay.reason}` };
  const now = Date.now();
  const payment: PendingPayment = {
    paymentId: crypto.randomUUID(),
    amountCents: pay.amountCents,
    merchant: pay.merchant,
    destination: pay.destination,
    pixPayload: pay.pixPayload,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + PAYMENT_TTL_MS).toISOString()
  };
  // Session storage: in memory only, cleared when the browser closes.
  await chrome.storage.session.set({ [`payment:${payment.paymentId}`]: payment });
  const settings = await getSettings();
  const fragment = new URLSearchParams({ pay: payment.paymentId, ext: chrome.runtime.id });
  log.info("payment.created", { paymentId: payment.paymentId, amountCents: payment.amountCents, destination: payment.destination });
  return { ok: true, type: "PAYMENT_CREATED", paymentId: payment.paymentId, url: `${settings.fundingAppUrl.split("#")[0]}#${fragment}` };
}

async function getWalletStatus(): Promise<WalletStatus | null> {
  const { walletStatus } = await chrome.storage.local.get("walletStatus");
  return (walletStatus as WalletStatus | undefined) ?? null;
}

type ExternalMessage =
  | { type: "GET_PAYMENT_CONTEXT"; paymentId: string }
  /** The web app asks which executor to bind a new agent run to. */
  | { type: "GET_EXECUTOR" }
  /** The web app started a run bound to this executor: poll now. */
  | { type: "AGENT_RUN_STARTED" }
  | { type: "REPORT_WALLET_STATUS"; status: unknown }
  /** Connectivity test from the web app (/diagnostics). Read-only. */
  | { type: "PING" }
  | { type: "WALLET_DISCONNECTED" };

async function handleExternal(message: ExternalMessage, origin: string | undefined): Promise<unknown> {
  const settings = await getSettings();
  if (!isAllowedPayOrigin(origin, settings.fundingAppUrl)) {
    log.warn("external.rejected_origin", { origin: origin ?? null });
    return { ok: false, error: "origin not allowed" };
  }
  switch (message?.type) {
    case "GET_PAYMENT_CONTEXT": {
      if (typeof message.paymentId !== "string") return { ok: false, error: "missing paymentId" };
      const key = `payment:${message.paymentId}`;
      const payment = (await chrome.storage.session.get(key))[key] as PendingPayment | undefined;
      if (!payment || Date.parse(payment.expiresAt) < Date.now()) return { ok: false, error: "payment expired or unknown" };
      return { ok: true, payment };
    }
    case "REPORT_WALLET_STATUS": {
      const status = parseWalletReport(message.status);
      if (!status) return { ok: false, error: "invalid wallet status" };
      await chrome.storage.local.set({ walletStatus: status });
      log.info("wallet.status", { state: status.agentState, checkedAt: status.checkedAt });
      return { ok: true };
    }
    case "WALLET_DISCONNECTED":
      await chrome.storage.local.remove("walletStatus");
      return { ok: true };
    case "GET_EXECUTOR": {
      const identity = await executorIdentity(settings);
      return identity ? { ok: true, ...identity } : { ok: false, error: "agent-api is not configured in the extension settings" };
    }
    case "AGENT_RUN_STARTED":
      executor.nudge("run-started");
      return { ok: true };
    case "PING":
      return { ok: true, report: await connectivity(settings, origin ?? null) };
    default:
      return { ok: false, error: "unsupported message" };
  }
}

const executor = scheduleExecutor(getSettings, getObserverId);

// ---------------------------------------------------------------------------
// Extension Dev Bridge (development only): sanitized snapshots → UPAY3FOOD
// ---------------------------------------------------------------------------

const bridgeState: { sent: number; lastSentAt: string | null; lastStatus: number | null; lastError: string | null } = {
  sent: 0,
  lastSentAt: null,
  lastStatus: null,
  lastError: null
};

function bridgeOrigin(settings: ExtensionSettings): string | null {
  try {
    return new URL(settings.devBridgeUrl || "https://upay3food.com").origin;
  } catch {
    return null;
  }
}

function bridgeStatus(settings: ExtensionSettings): BridgeStatus {
  return {
    enabled: !!(settings.debug && settings.devBridgeEnabled),
    origin: bridgeOrigin(settings),
    sessionId: settings.devBridgeSessionId ?? null,
    ...bridgeState
  };
}

async function bridgeStart(): Promise<ExtensionResponse> {
  const settings = await getSettings();
  const origin = bridgeOrigin(settings);
  if (!origin || !settings.devBridgeToken) return { ok: false, error: "set the bridge URL and token first" };
  let response: Response;
  try {
    response = await fetch(`${origin}/api/dev/extension/session`, {
      method: "POST",
      credentials: "omit",
      headers: { authorization: `Bearer ${settings.devBridgeToken}` }
    });
  } catch {
    return { ok: false, error: `could not reach ${origin} (network or site access blocked; check chrome://extensions → Details → Site access)` };
  }
  if (!response.ok) return { ok: false, error: `bridge answered HTTP ${response.status}${response.status === 404 ? " (bridge not configured on the server)" : response.status === 401 ? " (wrong token)" : ""}` };
  const { sessionId } = (await response.json()) as { sessionId: string };
  const next = { ...settings, devBridgeEnabled: true, devBridgeSessionId: sessionId };
  await chrome.storage.local.set({ settings: next });
  Object.assign(bridgeState, { sent: 0, lastSentAt: null, lastStatus: null, lastError: null });
  log.info("bridge.session", { sessionId });
  return { ok: true, type: "BRIDGE_STATUS", status: bridgeStatus(next) };
}

async function bridgeSend(payload: DevSnapshotPayload): Promise<ExtensionResponse> {
  const settings = await getSettings();
  const origin = bridgeOrigin(settings);
  if (!settings.debug || !settings.devBridgeEnabled || !settings.devBridgeSessionId || !settings.devBridgeToken || !origin) {
    return { ok: false, error: "bridge off" };
  }
  try {
    const response = await fetch(`${origin}/api/dev/extension/session/${encodeURIComponent(settings.devBridgeSessionId)}/snapshot`, {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json", authorization: `Bearer ${settings.devBridgeToken}` },
      body: JSON.stringify(payload)
    });
    bridgeState.lastStatus = response.status;
    if (response.ok) {
      bridgeState.sent++;
      bridgeState.lastSentAt = new Date().toISOString();
      bridgeState.lastError = null;
    } else {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      bridgeState.lastError = (body.error ?? `HTTP ${response.status}`).slice(0, 200);
    }
  } catch (error) {
    bridgeState.lastStatus = null;
    bridgeState.lastError = errorMessage(error).slice(0, 200);
  }
  return { ok: true, type: "BRIDGE_STATUS", status: bridgeStatus(settings) };
}

/**
 * Connectivity test, link by link: background (this code runs), content
 * script in the iFood tab (PING → PONG with its page context only), agent-api
 * configuration and the executor's last poll. No commercial action, no page
 * content, no tokens.
 */
async function connectivity(settings: ExtensionSettings, webOrigin: string | null): Promise<ConnectivityReport> {
  const tabs = await chrome.tabs.query({ url: "https://*.ifood.com.br/*" });
  const tab = tabs.find((t) => t.active) ?? tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
  let ifoodContentScript: ConnectivityReport["ifoodContentScript"] = { status: "no-ifood-tab", context: null, latencyMs: null };
  if (tab?.id !== undefined) {
    const started = Date.now();
    try {
      const pong = (await chrome.tabs.sendMessage(tab.id, { type: "PING" } satisfies ExtensionMessage)) as ExtensionResponse;
      ifoodContentScript =
        pong.ok && pong.type === "PONG"
          ? { status: "connected", context: pong.context, latencyMs: Date.now() - started }
          : { status: "not-responding", context: null, latencyMs: null };
    } catch {
      ifoodContentScript = { status: "not-responding", context: null, latencyMs: null };
    }
  }
  const health = await executorHealth(settings);
  return {
    checkedAt: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest().version,
    extensionId: chrome.runtime.id,
    background: "connected",
    ifoodContentScript,
    agentApi: {
      configured: health.agentApiConfigured,
      origin: health.agentApiOrigin,
      executorRegistered: health.registered,
      executorId: health.executorId,
      lastPoll: health.lastPoll
    },
    webOrigin,
    bridge: bridgeStatus(settings)
  };
}

chrome.runtime.onMessageExternal.addListener((message: ExternalMessage, sender, sendResponse) => {
  handleExternal(message, sender.origin ?? (sender.url ? new URL(sender.url).origin : undefined))
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: errorMessage(error) }));
  return true;
});

async function handle(message: ExtensionMessage, tabId: number | undefined): Promise<ExtensionResponse> {
  switch (message.type) {
    case "CREATE_PAYMENT":
      return createPayment(message.snapshot);
    case "GET_WALLET_STATUS":
      return { ok: true, type: "WALLET_STATUS", status: await getWalletStatus() };
    case "RECORD_SNAPSHOT":
      executor.nudge("page-changed");
      return { ok: true, type: "MARKET", market: await handleRecord(message.snapshot, tabId) };
    case "RECORD_MENU":
      return recordMenu(message.menu);
    case "GET_MENUS":
      return { ok: true, type: "MENUS", menus: await getMenus() };
    case "PLAN_INTENT":
      return handlePlan(message.request, message.snapshot);
    case "GET_SETTINGS":
      return { ok: true, type: "SETTINGS", settings: await getSettings() };
    case "SAVE_SETTINGS":
      await chrome.storage.local.set({ settings: message.settings });
      return { ok: true, type: "SETTINGS", settings: await getSettings() };
    case "CLEAR_OBSERVATIONS":
      await chrome.storage.local.set({ observations: [], menus: [] });
      return { ok: true, type: "DONE" };
    case "GET_CONNECTIVITY":
      return { ok: true, type: "CONNECTIVITY", report: await connectivity(await getSettings(), null) };
    case "BRIDGE_SNAPSHOT":
      return bridgeSend(message.payload);
    case "BRIDGE_START":
      return bridgeStart();
    case "GET_BRIDGE_STATUS":
      return { ok: true, type: "BRIDGE_STATUS", status: bridgeStatus(await getSettings()) };
    case "GET_SNAPSHOT":
    case "REVEAL_ITEM":
    case "GET_DOM_CAPTURE":
    case "GET_PAGE_CAPTURE":
    case "PING":
      return { ok: false, error: "handled by the content script" };
    default:
      return { ok: false, error: `unsupported message ${(message as { type: string }).type}` };
  }
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse: (r: ExtensionResponse) => void) => {
  if (message.type === "GET_SNAPSHOT" || message.type === "GET_DOM_CAPTURE" || message.type === "GET_PAGE_CAPTURE" || message.type === "PING" || message.type === "REVEAL_ITEM") return false; // content script
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
