import {
  matchesRequirement,
  normalizeTitle,
  requirementOf,
  type MarketObservation,
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
  // Invalid quotes (ambiguous container, failed reconciliation, unreadable
  // items) are never recorded and never reach the decision engine.
  if (!cart.validity.valid) return { ok: false, reason: `checkout not validated: ${cart.validity.reasons.join("; ")}` };
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
      merchant: {
        name: cart.merchantName.value ?? snapshot.merchant?.name ?? "unknown merchant",
        ...(snapshot.merchant ? { sourceMerchantId: snapshot.merchant.platformId, sourcePath: snapshot.merchant.path } : {})
      },
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
  if (!first) return null;
  const requirement = requirementOf(first);
  // Every line must be the same comparable product (same category and key).
  if (products.some((p) => !p || !matchesRequirement(p, requirement).equivalent)) return null;
  // Keyed categories need their key (açaí volume, pizza size, sushi pieces).
  const keyMissing =
    (first.category === "acai" && first.volumeMl === undefined) ||
    (first.category === "pizza" && first.size === undefined) ||
    (first.category === "sushi" && first.pieces === undefined);
  if (keyMissing) return null;
  return { requirement, quantity: observation.quote.lines.reduce((sum, line) => sum + line.quantity, 0) };
}

/** Same cart = same observer, source and merchant within this window. */
export const CART_SESSION_MS = 60 * 60_000;

/**
 * Adds a new observation and retires earlier states of the *same cart*
 * (same observer, source and merchant, last 60 min). A cart that went from
 * 1x to 2x with a coupon is one order, not two market observations; keeping
 * the old state would feed stale prices to the market view and the agent.
 */
export function mergeObservation(
  existing: readonly MarketObservation[],
  observation: CartQuoteObservation,
  max: number
): { next: MarketObservation[]; superseded: MarketObservation[] } {
  const sameCart = (o: MarketObservation) =>
    o.kind === "cart-quote" &&
    o.observerId === observation.observerId &&
    o.source === observation.source &&
    o.quote.merchant.name === observation.quote.merchant.name &&
    Math.abs(Date.parse(o.observedAt) - Date.parse(observation.observedAt)) < CART_SESSION_MS;
  const superseded = existing.filter(sameCart);
  const kept = existing.filter((o) => !sameCart(o));
  return { next: [observation, ...kept].slice(0, max), superseded };
}
