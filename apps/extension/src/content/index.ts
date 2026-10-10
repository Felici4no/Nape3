import type { MenuObservation } from "@nape3/agent";
import { createLogger, errorMessage } from "../shared/log";
import {
  DEFAULT_SETTINGS,
  type ExtensionMessage,
  type ExtensionResponse,
  type ExtensionSettings,
  type MarketView,
  type PageSnapshot
} from "../shared/types";
import { removeBadge, renderBadge as renderBadgeNow, whenPageSettled } from "./badge";
import { captureOrderDom, capturePage } from "./capture";
import { takeSnapshot } from "./extract";
import { bridgeKey, buildBridgePayload, MIN_INTERVAL_MS } from "./devbridge";
import { createMerchantMemory } from "./merchant";
import type { MenuCard } from "../shared/types";
import { clearHighlights, pickHighlights, renderHighlights, revealItem, type RecommendedItem } from "./highlight";

/** Keeps the restaurant (from its URL) while the user opens a product, the bag or checkout in this tab. */
const merchants = createMerchantMemory();

const log = createLogger("content");
const ORDER_CONTEXTS = new Set(["CART", "CHECKOUT", "PIX_PAYMENT"]);

let settings: ExtensionSettings = DEFAULT_SETTINGS;
let lastFingerprint = "";
let lastMarket: MarketView | null = null;
let lastSnapshot: PageSnapshot | null = null;
let pageSettled = false;

/** The badge is opt-in and never mounted before the page has hydrated. */
function renderBadge(doc: Document, snapshot: PageSnapshot, market: MarketView | null, debug: boolean) {
  if (!settings.showBadge || !pageSettled) {
    removeBadge();
    return;
  }
  renderBadgeNow(doc, snapshot, market, debug);
}

/**
 * Everything that defines the order state. Any change (quantity, delivery
 * mode, coupon, items, route) produces a new fingerprint → re-record.
 */
function fingerprint(snapshot: PageSnapshot): string {
  const cart = snapshot.cart;
  return JSON.stringify([
    location.pathname,
    snapshot.detection.context,
    cart && [
      cart.lines.map((l) => [l.sourceTitle, l.quantity, l.lineTotalCents]),
      cart.itemsSubtotalCents.value,
      cart.deliveryFeeCents.value,
      cart.serviceFeeCents.value,
      cart.discountCents.value,
      cart.totalCents.value,
      cart.validity.valid
    ],
    snapshot.pix?.amountCents.value,
    snapshot.pix?.copyPastePayload.value
  ]);
}

let lastBridgeKey = "";
let lastBridgeAt = 0;
let bridgeRetry: ReturnType<typeof setTimeout> | undefined;

/** Dev bridge (Debug mode + bridge on + a session): every page context, not only orders. */
function sendToBridge(snapshot: PageSnapshot) {
  if (!settings.debug || !settings.devBridgeEnabled || !settings.devBridgeSessionId) return;
  const key = bridgeKey(document, snapshot);
  const now = Date.now();
  if (key === lastBridgeKey) return;
  if (now - lastBridgeAt < MIN_INTERVAL_MS) {
    // Too soon: send the page's state once the interval is over, so the last
    // change (e.g. search results replacing the loading spinner) is not lost.
    clearTimeout(bridgeRetry);
    bridgeRetry = setTimeout(() => {
      try {
        sendToBridge(takeSnapshot(document, location.href, new Date(), merchants));
      } catch (error) {
        log.warn("bridge.retry_failed", { error: errorMessage(error) });
      }
    }, MIN_INTERVAL_MS - (now - lastBridgeAt) + 50);
    return;
  }
  lastBridgeKey = key;
  lastBridgeAt = now;
  try {
    const payload = buildBridgePayload(document, snapshot, chrome.runtime.getManifest().version);
    void chrome.runtime.sendMessage({ type: "BRIDGE_SNAPSHOT", payload } satisfies ExtensionMessage).catch(() => undefined);
  } catch (error) {
    log.warn("bridge.capture_failed", { error: errorMessage(error) });
  }
}

let recommended: RecommendedItem | null = null;
let lastMenu: MenuCard[] | undefined;

/** Outlines the best items (and the agent's pick for this shop) once the page has settled. */
function highlight(snapshot: PageSnapshot) {
  if (settings.highlightMenu === false || !pageSettled) return;
  const context = snapshot.detection.context;
  if (context === "PRODUCT") {
    // A product modal is open (often straight from a recommendation link): never draw over it.
    // The menu is kept, so the outlines come back as soon as the modal closes.
    clearHighlights();
    return;
  }
  if (context !== "RESTAURANT") {
    lastMenu = undefined;
    clearHighlights();
    return;
  }
  if (snapshot.restaurant?.menu?.length) lastMenu = snapshot.restaurant.menu;
  if (!lastMenu?.length) return;
  const key = snapshot.merchant?.path ?? snapshot.merchant?.name ?? snapshot.restaurant?.merchantName.value ?? null;
  const pick = recommended && key && (recommended.merchantKey === key || recommended.merchantKey === snapshot.merchant?.name) ? recommended : null;
  try {
    renderHighlights(document, pickHighlights(lastMenu, pick));
  } catch (error) {
    log.warn("highlight.failed", { error: errorMessage(error) });
  }
}

let lastMenuKey = "";

/** Restaurant pages: hand the visible menu (titles and prices only) to the background, once per change. */
function recordMenu(snapshot: PageSnapshot) {
  const restaurant = snapshot.restaurant;
  if (!restaurant?.menu?.length) return;
  const name = snapshot.merchant?.name ?? restaurant.merchantName.value;
  if (!name) return;
  const key = `${snapshot.merchant?.platformId ?? name}|${restaurant.menu.length}|${restaurant.deliveryFeeCents.value}`;
  if (key === lastMenuKey) return;
  lastMenuKey = key;
  const menu: MenuObservation = {
    merchant: { name, ...(snapshot.merchant ? { platformId: snapshot.merchant.platformId, path: snapshot.merchant.path } : {}) },
    source: snapshot.source,
    observedAt: snapshot.capturedAt,
    deliveryFeeCents: restaurant.deliveryFeeCents.value,
    items: restaurant.menu.map((item) => ({ title: item.title, priceCents: item.priceCents, originalPriceCents: item.originalPriceCents, itemId: item.itemId ?? null }))
  };
  void chrome.runtime.sendMessage({ type: "RECORD_MENU", menu } satisfies ExtensionMessage).catch(() => undefined);
}

async function observe(trigger: string): Promise<void> {
  let snapshot: PageSnapshot;
  try {
    snapshot = takeSnapshot(document, location.href, new Date(), merchants);
  } catch (error) {
    log.error("snapshot.failed", { error: errorMessage(error) });
    return;
  }
  sendToBridge(snapshot);
  recordMenu(snapshot);
  highlight(snapshot);
  if (!ORDER_CONTEXTS.has(snapshot.detection.context)) {
    lastFingerprint = "";
    lastSnapshot = null;
    removeBadge();
    return;
  }
  const key = fingerprint(snapshot);
  if (key === lastFingerprint) return;
  lastFingerprint = key;
  lastSnapshot = snapshot;
  log.info("snapshot.changed", {
    trigger,
    snapshotId: snapshot.snapshotId,
    capturedAt: snapshot.capturedAt,
    context: snapshot.detection.context,
    valid: snapshot.cart?.validity.valid ?? null,
    totalCents: snapshot.cart?.totalCents.value ?? null
  });

  // Show the fresh extraction immediately; never keep the previous market view
  // next to a new cart state.
  lastMarket = null;
  renderBadge(document, snapshot, null, settings.debug);
  try {
    const response = (await chrome.runtime.sendMessage({ type: "RECORD_SNAPSHOT", snapshot } satisfies ExtensionMessage)) as ExtensionResponse;
    if (response.ok && response.type === "MARKET" && lastSnapshot?.snapshotId === snapshot.snapshotId) {
      lastMarket = response.market;
      renderBadge(document, snapshot, lastMarket, settings.debug);
    }
  } catch (error) {
    // Typically the extension was reloaded; the page needs a reload too.
    log.warn("background.unreachable", { error: errorMessage(error) });
  }
}

// iFood is a single-page app: re-read (never modify) the DOM whenever it
// changes — items, quantity steppers, coupon, delivery/pickup toggles, drawers
// opening/closing (class/style/hidden/aria attributes) and route changes.
const DEBOUNCE_MS = 400;
const MAX_WAIT_MS = 2000;
let timer: ReturnType<typeof setTimeout> | undefined;
let firstPendingAt = 0;
let lastUrl = location.href;

function schedule(trigger: string) {
  const now = Date.now();
  if (!timer) firstPendingAt = now;
  clearTimeout(timer);
  const wait = now - firstPendingAt >= MAX_WAIT_MS ? 0 : DEBOUNCE_MS;
  timer = setTimeout(() => {
    timer = undefined;
    void observe(trigger);
  }, wait);
}

const observer = new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    schedule("route-change");
  } else {
    schedule("dom-mutation");
  }
});
if (document.body) {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden", "aria-hidden", "aria-checked", "aria-selected", "checked", "open", "inert"]
  });
}
window.addEventListener("popstate", () => schedule("popstate"));

chrome.storage.local.get("settings").then(({ settings: stored }) => {
  settings = { ...DEFAULT_SETTINGS, ...(stored as Partial<ExtensionSettings> | undefined) };
  void observe("initial");
});
chrome.storage.local.get("recommended").then(({ recommended: stored }) => {
  recommended = (stored as RecommendedItem | null | undefined) ?? null;
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.recommended) {
    recommended = (changes.recommended.newValue as RecommendedItem | null | undefined) ?? null;
    lastFingerprint = "";
    void observe("recommendation");
  }
  if (!changes.settings) return;
  settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue as Partial<ExtensionSettings> | undefined) };
  if (lastSnapshot) renderBadge(document, lastSnapshot, lastMarket, settings.debug);
});
void whenPageSettled(window).then(() => {
  pageSettled = true;
  void observe("settled");
  if (lastSnapshot) renderBadge(document, lastSnapshot, lastMarket, settings.debug);
});

// The popup always gets a *fresh* extraction — never a cached snapshot.
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse: (response: ExtensionResponse) => void) => {
    if (message.type === "REVEAL_ITEM") {
      sendResponse({ ok: true, type: "REVEALED", found: revealItem(document, message.title, message.priceCents) });
      return false;
    }
    if (message.type === "PING") {
      sendResponse({ ok: true, type: "PONG", context: takeSnapshot(document, location.href, new Date(), merchants).detection.context, at: new Date().toISOString() });
      return false;
    }
    if (message.type !== "GET_SNAPSHOT" && message.type !== "GET_DOM_CAPTURE" && message.type !== "GET_PAGE_CAPTURE") return false;
    try {
      if (message.type === "GET_PAGE_CAPTURE") {
        const capture = capturePage(document, takeSnapshot(document, location.href, new Date(), merchants), { redactions: message.redactions, structureOnly: message.structureOnly ?? false });
        sendResponse({ ok: true, type: "PAGE_CAPTURE", capture });
        return false;
      }
      sendResponse(
        message.type === "GET_DOM_CAPTURE"
          ? { ok: true, type: "DOM_CAPTURE", capture: captureOrderDom(document) }
          : { ok: true, type: "SNAPSHOT", snapshot: takeSnapshot(document, location.href, new Date(), merchants) }
      );
    } catch (error) {
      sendResponse({ ok: false, error: errorMessage(error) });
    }
    return false;
  }
);
