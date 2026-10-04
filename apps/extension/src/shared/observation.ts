import {
  normalizeTitle,
  type CartQuoteObservation,
  type ProductRequirement
} from "@nape3/domain";
import { sanitizeObservation } from "@nape3/market";
import type { ExtensionSettings, PageSnapshot } from "./types";

export const COLLECTOR_VERSION = "ext-0.2.0";

export type BuildResult = { ok: true; observation: CartQuoteObservation } | { ok: false; reason: string };

/**
 * Turns a CART/CHECKOUT/PIX snapshot into a MarketObservation. Only
 * commercial fields are used, and the result goes through the same allowlist
 * sanitizer the observation network uses.
 */
export function snapshotToObservation(
  snapshot: PageSnapshot,
  settings: ExtensionSettings,
  observerId: string
): BuildResult {
  const cart = snapshot.cart;
  if (!cart) return { ok: false, reason: `no order summary in context ${snapshot.detection.context}` };
  const required = {
    subtotal: cart.itemsSubtotalCents.value,
    total: cart.totalCents.value,
    delivery: cart.deliveryFeeCents.value,
    service: cart.serviceFeeCents.value,
    discount: cart.discountCents.value
  };
  const missingFields = Object.entries(required)
    .filter(([, value]) => value === null)
    .map(([key]) => key);
  if (missingFields.length) return { ok: false, reason: `missing ${missingFields.join(", ")}` };
  if (cart.lines.length === 0) return { ok: false, reason: "cart items could not be read reliably (lines did not add up to the subtotal)" };

  const observedAt = snapshot.capturedAt;
  const raw = {
    id: `ext-${observerId.slice(0, 8)}-${Date.parse(observedAt)}`,
    kind: "cart-quote",
    source: snapshot.source,
    observedAt,
    observerId,
    context: {
      ...(settings.marketRegion ? { marketRegion: settings.marketRegion } : {}),
      ...(cart.eta.value ? { etaMinutes: cart.eta.value } : {}),
      membership: settings.membership,
      // A discount is visible but its scope (public coupon vs account-only) is not.
      promotionScope: required.discount! > 0 ? "unknown" : "none"
    },
    provenance: {
      method: "browser-extension",
      live: true,
      synthetic: false,
      collectorVersion: COLLECTOR_VERSION,
      rawReference: snapshot.pageRef
    },
    quote: {
      source: snapshot.source,
      merchant: { name: cart.merchantName.value ?? "unknown merchant" },
      stage: snapshot.detection.context === "PIX_PAYMENT" ? "pix-payment" : cart.stage,
      lines: cart.lines.map((line) => ({
        sourceTitle: line.sourceTitle,
        quantity: line.quantity,
        lineTotalCents: line.lineTotalCents
      })),
      itemsSubtotalCents: required.subtotal,
      deliveryFeeCents: required.delivery,
      serviceFeeCents: required.service,
      discountCents: required.discount,
      totalCents: required.total,
      currency: "BRL"
    }
  };
  const sanitized = sanitizeObservation(raw);
  if (!sanitized.ok) return { ok: false, reason: sanitized.errors.join("; ") };
  if (sanitized.observation.kind !== "cart-quote") return { ok: false, reason: "unexpected observation kind" };
  if (cart.eta.value) {
    sanitized.observation.quote.fulfillment = {
      mode: "delivery",
      etaMinutes: cart.eta.value,
      deliveryFeeCents: sanitized.observation.quote.deliveryFeeCents,
      currency: "BRL"
    };
  }
  return { ok: true, observation: sanitized.observation };
}

/** The product the cart is for, when every line is the same canonical product. */
export function requirementFromObservation(
  observation: CartQuoteObservation
): { requirement: ProductRequirement; quantity: number } | null {
  const products = observation.quote.lines.map((line) => line.product ?? normalizeTitle(line.sourceTitle).product);
  const first = products[0];
  if (!first || products.some((p) => !p || p.category !== first.category || p.volumeMl !== first.volumeMl)) return null;
  if (first.volumeMl === undefined) return null;
  return {
    requirement: { category: first.category, volumeMl: first.volumeMl },
    quantity: observation.quote.lines.reduce((sum, line) => sum + line.quantity, 0)
  };
}
