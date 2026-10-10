import { parseServings, parseVolumeMl, parseWeightG } from "./volume";

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

export interface CostInsights extends UnitInsights {
  weightG: number | null;
  pricePer100gCents: number | null;
  pricePerLiterCents: number | null;
  servings: number | null;
  /** What 100 ml really costs once the fees are spread over the volume. */
  effectivePer100mlCents: number | null;
  /** The fees expressed in this product: "as taxas valem N ml deste açaí". */
  feesAsProductMl: number | null;
  feesAsProductG: number | null;
  /** Total with fees, per person served. */
  totalPerServingCents: number | null;
}

/**
 * Normalized cost views of one product so different sizes and shops can be
 * compared: per 100 ml / litre / 100 g, per person, the real per-100 ml once
 * fees are included, and the fees converted into product.
 */
export function costInsights(input: {
  title: string | null;
  priceCents: number;
  originalPriceCents?: number | null;
  servingsText?: string | null;
  /** Fees attributed to this product (delivery + service), when known or estimated. */
  feesCents?: number | null;
}): CostInsights {
  const unit = unitInsights(input);
  const weightG = input.title ? parseWeightG(input.title) : null;
  const servings = input.servingsText ? parseServings(input.servingsText) : null;
  const fees = input.feesCents ?? null;
  const total = fees === null ? null : input.priceCents + fees;
  const ml = unit.volumeMl;
  return {
    ...unit,
    weightG,
    pricePer100gCents: weightG ? Math.round((input.priceCents * 100) / weightG) : null,
    pricePerLiterCents: ml ? Math.round((input.priceCents * 1000) / ml) : null,
    servings,
    effectivePer100mlCents: ml && total !== null ? Math.round((total * 100) / ml) : null,
    feesAsProductMl: ml && fees !== null && input.priceCents > 0 ? Math.round((fees * ml) / input.priceCents) : null,
    feesAsProductG: weightG && fees !== null && input.priceCents > 0 ? Math.round((fees * weightG) / input.priceCents) : null,
    totalPerServingCents: servings && total !== null ? Math.round(total / servings) : null
  };
}

export interface MenuItemInput {
  title: string;
  priceCents: number;
  originalPriceCents?: number | null;
}

export interface MenuValue {
  /** Items with a volume, cheapest per 100 ml first. */
  ranked: Array<MenuItemInput & { volumeMl: number; pricePer100mlCents: number }>;
  best: (MenuItemInput & { volumeMl: number; pricePer100mlCents: number }) | null;
  worst: (MenuItemInput & { volumeMl: number; pricePer100mlCents: number }) | null;
  /** How much cheaper per 100 ml the best item is than the worst, in percent. */
  spreadPct: number | null;
  /** Items without a readable volume (not ranked). */
  unranked: number;
}

/** "Tamanho que compensa": ranks a shop's menu by price per 100 ml. Duplicate cards are counted once. */
export function menuValue(items: readonly MenuItemInput[]): MenuValue {
  const seen = new Set<string>();
  const ranked: MenuValue["ranked"] = [];
  let unranked = 0;
  for (const item of items) {
    const key = `${item.title.trim().toLowerCase()}|${item.priceCents}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const volumeMl = parseVolumeMl(item.title);
    if (!volumeMl || item.priceCents <= 0) {
      unranked += 1;
      continue;
    }
    ranked.push({ ...item, volumeMl, pricePer100mlCents: Math.round((item.priceCents * 100) / volumeMl) });
  }
  ranked.sort((a, b) => a.pricePer100mlCents - b.pricePer100mlCents || b.volumeMl - a.volumeMl);
  const best = ranked[0] ?? null;
  const worst = ranked.length > 1 ? ranked[ranked.length - 1]! : null;
  return {
    ranked,
    best,
    worst,
    spreadPct: best && worst && worst.pricePer100mlCents > 0 ? pct(worst.pricePer100mlCents - best.pricePer100mlCents, worst.pricePer100mlCents) : null,
    unranked
  };
}
