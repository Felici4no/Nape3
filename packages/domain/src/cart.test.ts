import { describe, expect, it } from "vitest";
import { computeCartTotal, quoteMatchesRequirement, verifyCartQuote } from "./cart";
import { cents } from "./money";
import { normalizeTitle } from "./normalize";
import type { CartQuote } from "./types";

function quote(overrides: Partial<CartQuote> = {}): CartQuote {
  return {
    source: "ifood",
    merchant: { name: "Açaí do Bairro" },
    stage: "checkout",
    lines: [
      {
        sourceTitle: "Açaí 500ml",
        product: normalizeTitle("Açaí 500ml").product,
        quantity: 1,
        unitPriceCents: cents(1990),
        lineTotalCents: cents(1990)
      }
    ],
    itemsSubtotalCents: cents(1990),
    deliveryFeeCents: cents(599),
    serviceFeeCents: cents(99),
    discountCents: cents(500),
    totalCents: cents(2188),
    currency: "BRL",
    ...overrides
  };
}

describe("cart totals", () => {
  it("total = subtotal + delivery + service − discount", () => {
    expect(computeCartTotal(quote())).toBe(2188);
  });

  it("never goes below zero", () => {
    expect(computeCartTotal(quote({ discountCents: cents(99999) }))).toBe(0);
  });

  it("rejects negative discount representation", () => {
    expect(() => computeCartTotal(quote({ discountCents: cents(-500) }))).toThrow(RangeError);
  });

  it("flags displayed totals that do not reconcile", () => {
    expect(verifyCartQuote(quote()).consistent).toBe(true);
    const bad = verifyCartQuote(quote({ totalCents: cents(2288) }));
    expect(bad.consistent).toBe(false);
    expect(bad.differenceCents).toBe(100);
  });
});

describe("cart comparability", () => {
  it("accepts a cart containing only the requested product", () => {
    expect(quoteMatchesRequirement(quote(), { category: "acai", volumeMl: 500 }, 1).comparable).toBe(true);
  });

  it("rejects carts with extra items or wrong quantity", () => {
    const withSoda = quote({
      lines: [
        ...quote().lines,
        { sourceTitle: "Coca-Cola 350ml", product: null, quantity: 1, lineTotalCents: cents(600) }
      ]
    });
    expect(quoteMatchesRequirement(withSoda, { category: "acai", volumeMl: 500 }, 1).comparable).toBe(false);
    expect(quoteMatchesRequirement(quote(), { category: "acai", volumeMl: 500 }, 2).comparable).toBe(false);
  });
});
