import { createLogger, errorMessage } from "../shared/log";
import type { ExtensionMessage, ExtensionResponse, MarketView, PageSnapshot } from "../shared/types";
import { removeBadge, renderBadge } from "./badge";
import { takeSnapshot } from "./extract";

const log = createLogger("content");
const ORDER_CONTEXTS = new Set(["CART", "CHECKOUT", "PIX_PAYMENT"]);

let lastKey = "";

function snapshotKey(snapshot: PageSnapshot): string {
  const cart = snapshot.cart;
  return [snapshot.detection.context, cart?.itemsSubtotalCents.value, cart?.totalCents.value, snapshot.pix?.amountCents.value].join("|");
}

async function observe(): Promise<void> {
  let snapshot: PageSnapshot;
  try {
    snapshot = takeSnapshot(document, location.href);
  } catch (error) {
    log.error("snapshot.failed", { error: errorMessage(error) });
    return;
  }
  if (!ORDER_CONTEXTS.has(snapshot.detection.context)) {
    lastKey = "";
    removeBadge();
    return;
  }
  const key = snapshotKey(snapshot);
  if (key === lastKey) return;
  lastKey = key;

  let market: MarketView | null = null;
  try {
    const response = (await chrome.runtime.sendMessage({ type: "RECORD_SNAPSHOT", snapshot } satisfies ExtensionMessage)) as ExtensionResponse;
    if (response.ok && response.type === "MARKET") market = response.market;
  } catch (error) {
    // Typically the extension was reloaded; the page needs a reload too.
    log.warn("background.unreachable", { error: errorMessage(error) });
  }
  renderBadge(document, snapshot, market);
}

// iFood is a single-page app: re-read (never modify) the DOM when it changes.
let timer: ReturnType<typeof setTimeout> | undefined;
const observer = new MutationObserver(() => {
  clearTimeout(timer);
  timer = setTimeout(() => void observe(), 800);
});
if (document.body) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
void observe();

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse: (response: ExtensionResponse) => void) => {
    if (message.type !== "GET_SNAPSHOT") return false;
    try {
      sendResponse({ ok: true, type: "SNAPSHOT", snapshot: takeSnapshot(document, location.href) });
    } catch (error) {
      sendResponse({ ok: false, error: errorMessage(error) });
    }
    return false;
  }
);
