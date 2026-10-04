import {
  cents,
  computeCartTotal,
  normalizeTitle,
  type CartQuoteObservation,
  type Membership,
  type MarketObservation,
  type ProductOfferObservation,
  type PromotionScope,
  type SourcePlatform
} from "@nape3/domain";

/**
 * SYNTHETIC fixtures for the açaí wedge.
 *
 * These are invented, deterministic numbers for repeatable tests and demos.
 * They are NOT real prices from iFood, Rappi or 99Food and every record is
 * marked `provenance: { method: "fixture", synthetic: true, live: false }`.
 * Merchant names are fictitious.
 */

export const FIXTURE_NOW = new Date("2026-10-04T12:00:00.000Z");

export interface CartSpec {
  id: string;
  source: SourcePlatform;
  merchant: string;
  lines: Array<{ title: string; unit: number; quantity?: number }>;
  delivery: number;
  service: number;
  discount?: number;
  minutesAgo: number;
  region?: string;
  membership?: Membership;
  promotionScope?: PromotionScope;
  eta?: [number, number];
}

function at(minutesAgo: number, now: Date): string {
  return new Date(now.getTime() - minutesAgo * 60_000).toISOString();
}

export function cartObservation(spec: CartSpec, now: Date): CartQuoteObservation {
  const lines = spec.lines.map((line) => {
    const quantity = line.quantity ?? 1;
    return {
      sourceTitle: line.title,
      product: normalizeTitle(line.title).product,
      quantity,
      unitPriceCents: cents(line.unit),
      lineTotalCents: cents(line.unit * quantity)
    };
  });
  const parts = {
    itemsSubtotalCents: cents(lines.reduce((sum, line) => sum + line.lineTotalCents, 0)),
    deliveryFeeCents: cents(spec.delivery),
    serviceFeeCents: cents(spec.service),
    discountCents: cents(spec.discount ?? 0)
  };
  const eta = spec.eta ? { min: spec.eta[0], max: spec.eta[1] } : undefined;
  const observation: CartQuoteObservation = {
    id: spec.id,
    kind: "cart-quote",
    source: spec.source,
    observedAt: at(spec.minutesAgo, now),
    observerId: "fixture",
    context: {
      marketRegion: spec.region ?? "BR-SP-sao-paulo",
      membership: spec.membership ?? "none",
      promotionScope: spec.promotionScope ?? "none"
    },
    provenance: { method: "fixture", live: false, synthetic: true, rawReference: "fixtures/acai" },
    quote: {
      source: spec.source,
      merchant: { name: spec.merchant },
      stage: "checkout",
      lines,
      ...parts,
      totalCents: computeCartTotal(parts),
      currency: "BRL"
    }
  };
  if (eta) {
    observation.context.etaMinutes = eta;
    observation.quote.fulfillment = {
      mode: "delivery",
      etaMinutes: eta,
      deliveryFeeCents: parts.deliveryFeeCents,
      currency: "BRL"
    };
  }
  return observation;
}

const CART_SPECS: CartSpec[] = [
  // --- fresh, comparable 500 ml açaí, São Paulo -----------------------------
  { id: "fx-ifood-1", source: "ifood", merchant: "Açaí do Bairro (fictício)", lines: [{ title: "Açaí 500ml Tradicional", unit: 1590 }], delivery: 499, service: 99, minutesAgo: 10, eta: [30, 40] },
  { id: "fx-rappi-1", source: "rappi", merchant: "Point do Açaí (fictício)", lines: [{ title: "Açaí 500 ml c/ granola", unit: 1690 }], delivery: 399, service: 0, discount: 399, minutesAgo: 25, promotionScope: "public", eta: [35, 50] },
  { id: "fx-99food-1", source: "99food", merchant: "Tropical Açaí (fictício)", lines: [{ title: "AÇAÍ 500ML", unit: 1750 }], delivery: 299, service: 70, minutesAgo: 15, eta: [25, 35] },
  { id: "fx-ifood-2", source: "ifood", merchant: "Casa do Açaí (fictício)", lines: [{ title: "Copo de Açaí 0,5L", unit: 1890 }], delivery: 599, service: 99, discount: 400, minutesAgo: 40, membership: "ifood-club", promotionScope: "account-specific", eta: [20, 30] },
  { id: "fx-rappi-2", source: "rappi", merchant: "Açaí Express (fictício)", lines: [{ title: "Açaí meio litro", unit: 1990 }], delivery: 499, service: 0, minutesAgo: 30, membership: "rappi-prime", eta: [15, 25] },
  // --- same product, different region ---------------------------------------
  { id: "fx-99food-rj", source: "99food", merchant: "Açaí Carioca (fictício)", lines: [{ title: "Açaí 500ml", unit: 1500 }], delivery: 300, service: 50, minutesAgo: 20, region: "BR-RJ-rio-de-janeiro", eta: [30, 45] },
  // --- edge cases the engine must handle ------------------------------------
  { id: "fx-ifood-stale", source: "ifood", merchant: "Açaí Antigo (fictício)", lines: [{ title: "Açaí 500ml", unit: 1290 }], delivery: 299, service: 99, minutesAgo: 3 * 24 * 60, eta: [30, 40] },
  { id: "fx-ifood-300", source: "ifood", merchant: "Açaí do Bairro (fictício)", lines: [{ title: "Açaí 300ml", unit: 1090 }], delivery: 499, service: 99, minutesAgo: 12, eta: [30, 40] },
  { id: "fx-rappi-extra", source: "rappi", merchant: "Point do Açaí (fictício)", lines: [{ title: "Açaí 500ml", unit: 1690 }, { title: "Água mineral 500ml", unit: 400 }], delivery: 399, service: 0, minutesAgo: 18, eta: [35, 50] },
  { id: "fx-ifood-premium", source: "ifood", merchant: "Açaí Gourmet (fictício)", lines: [{ title: "Açaí 500ml Premium com Nutella", unit: 2490 }], delivery: 599, service: 99, minutesAgo: 8, eta: [40, 55] }
];

function itemObservation(now: Date): ProductOfferObservation {
  const title = "Açaí 500ml";
  return {
    id: "fx-99food-item",
    kind: "product-offer",
    source: "99food",
    observedAt: at(5, now),
    observerId: "fixture",
    context: { marketRegion: "BR-SP-sao-paulo", membership: "none", promotionScope: "none" },
    provenance: { method: "fixture", live: false, synthetic: true, rawReference: "fixtures/acai" },
    offer: {
      source: "99food",
      merchant: { name: "Tropical Açaí (fictício)" },
      sourceTitle: title,
      product: normalizeTitle(title).product,
      unitPriceCents: cents(1490),
      currency: "BRL"
    }
  };
}

/**
 * Returns the açaí fixture set with timestamps relative to `now`
 * (defaults to FIXTURE_NOW for deterministic tests).
 */
export function acaiFixtures(now: Date = FIXTURE_NOW): MarketObservation[] {
  return [...CART_SPECS.map((spec) => cartObservation(spec, now)), itemObservation(now)];
}
