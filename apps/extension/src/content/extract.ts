import type { PageSnapshot } from "../shared/types";
import { detectPageContext } from "./context";
import { extractCart, extractCheckout } from "./extractors/cart";
import { extractPixPayment } from "./extractors/pix";
import { extractProduct } from "./extractors/product";
import { extractRestaurant } from "./extractors/restaurant";
import type { MerchantMemory } from "./merchant";

/** Read-only: inspects the document and returns a snapshot. Never mutates the page. */
export function takeSnapshot(doc: Document, url: string, now: Date = new Date(), merchants?: MerchantMemory): PageSnapshot {
  const detection = detectPageContext(doc, url);
  const snapshot: PageSnapshot = {
    source: "ifood",
    snapshotId: `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    capturedAt: now.toISOString(),
    pageRef: `ifood:${detection.context.toLowerCase().replace(/_/g, "-")}`,
    detection
  };
  switch (detection.context) {
    case "RESTAURANT":
      snapshot.restaurant = extractRestaurant(doc);
      break;
    case "PRODUCT":
      snapshot.product = extractProduct(doc);
      break;
    case "CART":
      snapshot.cart = extractCart(doc);
      break;
    case "CHECKOUT":
      snapshot.cart = extractCheckout(doc);
      snapshot.pix = extractPixPayment(doc, now);
      break;
    case "PIX_PAYMENT":
      snapshot.pix = extractPixPayment(doc, now);
      // The order summary is often still visible next to the Pix code.
      snapshot.cart = extractCheckout(doc);
      break;
    default:
      break;
  }
  const pageMerchantName = snapshot.restaurant?.merchantName.value ?? snapshot.cart?.merchantName.value ?? null;
  const merchant = merchants?.resolve(url, detection.context, pageMerchantName, now);
  if (merchant) snapshot.merchant = merchant;
  return snapshot;
}
