import { extractIfoodOffer } from "./extract";
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
    if (message.type !== "GET_CURRENT_OFFER") return;

    try {
      sendResponse({
        ok: true,
        offer: extractIfoodOffer()
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Extraction failed"
      });
    }
  }
);
