import { parseVolumeMl } from "./volume";

/**
 * Buyer-side arithmetic for one delivery purchase: "you pay 3 times for food" —
 * the food, the fees, and whatever you pay above the cheapest comparable
 * observation. Pure and integer (cents); every estimate is flagged.
 */

/** iFood's per-order service fee since 2025-05-25 (used only when the page does not show it). */
export const IFOOD_SERVICE_FEE_CENTS = 99;

export interface PriceLayersInput {
  /** Items (subtotal, or the item price on a product page). */
  foodCents: number;
  /** null = not seen yet (e.g. product page before the bag). */
  deliveryFeeCents: number | null;
  serviceFeeCents: number | null;
  discountCents?: number | null;
  /** The checkout total when observed; otherwise it is computed. */
  totalCents?: number | null;
  /** Cheapest comparable total observed for the same intent, if any. */
  cheapestComparableCents?: number | null;
}

export interface PriceLayers {
  foodCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  discountCents: number;
  feesCents: number;
  totalCents: number;
  /** Share of the total that is fees, in percent (one decimal). */
  feeSharePct: number;
  /** What is paid above the cheapest comparable observation (≥ 0), or null without one. */
  overpayCents: number | null;
  /** True when any part was estimated rather than read from the page. */
  estimated: boolean;
  notes: string[];
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

export function priceLayers(input: PriceLayersInput): PriceLayers {
  const notes: string[] = [];
  let estimated = false;
  let delivery = input.deliveryFeeCents;
  if (delivery === null) {
    delivery = 0;
    estimated = true;
    notes.push("delivery fee not seen yet (shown in the bag)");
  }
  let service = input.serviceFeeCents;
  if (service === null) {
    service = IFOOD_SERVICE_FEE_CENTS;
    estimated = true;
    notes.push("service fee estimated at iFood's R$0,99 per order");
  }
  const discount = Math.max(0, input.discountCents ?? 0);
  const computed = input.foodCents + delivery + service - discount;
  const total = input.totalCents ?? computed;
  if (input.totalCents === undefined || input.totalCents === null) estimated = true;
  else if (input.totalCents !== computed) notes.push("observed total differs from the sum of its parts");
  const fees = delivery + service;
  const cheapest = input.cheapestComparableCents ?? null;
  return {
    foodCents: input.foodCents,
    deliveryFeeCents: delivery,
    serviceFeeCents: service,
    discountCents: discount,
    feesCents: fees,
    totalCents: total,
    feeSharePct: pct(fees, total),
    overpayCents: cheapest === null ? null : Math.max(0, total - cheapest),
    estimated,
    notes
  };
}

export interface UnitInsights {
  volumeMl: number | null;
  /** Price per 100 ml, rounded to the cent; null without a volume. */
  pricePer100mlCents: number | null;
  /** Shown discount against the struck price, or null without one. */
  discountCents: number | null;
  discountPct: number | null;
}

export function unitInsights(input: { title: string | null; priceCents: number; originalPriceCents?: number | null }): UnitInsights {
  const volumeMl = input.title ? parseVolumeMl(input.title) : null;
  const original = input.originalPriceCents ?? null;
  const discount = original !== null && original > input.priceCents ? original - input.priceCents : null;
  return {
    volumeMl,
    pricePer100mlCents: volumeMl ? Math.round((input.priceCents * 100) / volumeMl) : null,
    discountCents: discount,
    discountPct: discount !== null && original ? pct(discount, original) : null
  };
}
