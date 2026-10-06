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

async function observe(trigger: string): Promise<void> {
  let snapshot: PageSnapshot;
  try {
    snapshot = takeSnapshot(document, location.href);
  } catch (error) {
    log.error("snapshot.failed", { error: errorMessage(error) });
    return;
  }
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
chrome.storage.onChanged.addListener((changes) => {
  if (!changes.settings) return;
  settings = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue as Partial<ExtensionSettings> | undefined) };
  if (lastSnapshot) renderBadge(document, lastSnapshot, lastMarket, settings.debug);
});
void whenPageSettled(window).then(() => {
  pageSettled = true;
  if (lastSnapshot) renderBadge(document, lastSnapshot, lastMarket, settings.debug);
});

// The popup always gets a *fresh* extraction — never a cached snapshot.
chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse: (response: ExtensionResponse) => void) => {
    if (message.type === "PING") {
      sendResponse({ ok: true, type: "PONG", context: takeSnapshot(document, location.href).detection.context, at: new Date().toISOString() });
      return false;
    }
    if (message.type !== "GET_SNAPSHOT" && message.type !== "GET_DOM_CAPTURE" && message.type !== "GET_PAGE_CAPTURE") return false;
    try {
      if (message.type === "GET_PAGE_CAPTURE") {
        const capture = capturePage(document, takeSnapshot(document, location.href), { redactions: message.redactions, structureOnly: message.structureOnly ?? false });
        sendResponse({ ok: true, type: "PAGE_CAPTURE", capture });
        return false;
      }
      sendResponse(
        message.type === "GET_DOM_CAPTURE"
          ? { ok: true, type: "DOM_CAPTURE", capture: captureOrderDom(document) }
          : { ok: true, type: "SNAPSHOT", snapshot: takeSnapshot(document, location.href) }
      );
    } catch (error) {
      sendResponse({ ok: false, error: errorMessage(error) });
    }
    return false;
  }
);
