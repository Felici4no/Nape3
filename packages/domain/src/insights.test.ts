import { describe, expect, it } from "vitest";
import { priceLayers, unitInsights } from "./insights";

describe("priceLayers (you pay 3 times for food)", () => {
  it("splits a real bag: R$31,99 food + R$0,00 delivery + R$0,99 service = R$32,98", () => {
    const layers = priceLayers({ foodCents: 3199, deliveryFeeCents: 0, serviceFeeCents: 99, discountCents: 0, totalCents: 3298 });
    expect(layers).toMatchObject({ feesCents: 99, totalCents: 3298, estimated: false, overpayCents: null });
    expect(layers.feeSharePct).toBe(3);
  });

  it("estimates a product page: item + restaurant delivery fee + iFood service fee", () => {
    const layers = priceLayers({ foodCents: 1999, deliveryFeeCents: 699, serviceFeeCents: null });
    expect(layers).toMatchObject({ totalCents: 2797, feesCents: 798, estimated: true });
    expect(layers.feeSharePct).toBe(28.5);
    expect(layers.notes.join(" ")).toMatch(/service fee estimated/);
  });

  it("measures the third layer against the cheapest comparable observation", () => {
    expect(priceLayers({ foodCents: 2500, deliveryFeeCents: 500, serviceFeeCents: 99, totalCents: 3099, cheapestComparableCents: 2600 }).overpayCents).toBe(499);
    expect(priceLayers({ foodCents: 2000, deliveryFeeCents: 0, serviceFeeCents: 99, totalCents: 2099, cheapestComparableCents: 2600 }).overpayCents).toBe(0);
  });

  it("subtracts the discount and flags a total that does not add up", () => {
    const layers = priceLayers({ foodCents: 3180, deliveryFeeCents: 0, serviceFeeCents: 99, discountCents: 500, totalCents: 2800 });
    expect(layers.notes).toContain("observed total differs from the sum of its parts");
  });
});

describe("unitInsights", () => {
  it("prices per 100 ml and computes the shown discount", () => {
    expect(unitInsights({ title: "*Marmitex de Açaí 700ml", priceCents: 3199, originalPriceCents: 5790 })).toEqual({
      volumeMl: 700,
      pricePer100mlCents: 457,
      discountCents: 2591,
      discountPct: 44.7
    });
    expect(unitInsights({ title: "*Açaí + 2x Amendoim + 2x Leite Condensado 300ml", priceCents: 1999 })).toMatchObject({ volumeMl: 300, pricePer100mlCents: 666, discountCents: null });
    expect(unitInsights({ title: null, priceCents: 1000 }).pricePer100mlCents).toBeNull();
  });
});
