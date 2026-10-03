import type {
  ExtensionMessage,
  ExtensionResponse
} from "../shared/types";

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender,
    sendResponse: (response: ExtensionResponse) => void
  ) => {
    if (message.type !== "SAVE_OFFER") return;

    // Milestone 1: keep persistence intentionally local to the developer console.
    // The next step will replace this with POST /api/observations.
    console.log("[Nape3] captured offer", message.payload);

    sendResponse({ ok: true });
  }
);
