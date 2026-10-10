import { describe, expect, it } from "vitest";
import { costInsights, isBulkFormat, menuValue, priceLayers, unitInsights } from "./insights";
import { parseServings, parseWeightG } from "./volume";

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

describe("costInsights", () => {
  it("shows the real cost of 100 ml once fees are included, and the fees in product", () => {
    const c = costInsights({ title: "*Marmitex de Açaí 700ml", priceCents: 3199, originalPriceCents: 5790, servingsText: "Serve 1 pessoa", feesCents: 798 });
    expect(c).toMatchObject({
      volumeMl: 700,
      pricePer100mlCents: 457,
      pricePerLiterCents: 4570,
      effectivePer100mlCents: 571,
      feesAsProductMl: 175,
      servings: 1,
      totalPerServingCents: 3997,
      discountPct: 44.7
    });
  });

  it("handles weight and missing data", () => {
    expect(costInsights({ title: "Marmita fit 500g", priceCents: 2500, feesCents: 500 })).toMatchObject({ weightG: 500, pricePer100gCents: 500, feesAsProductG: 100, volumeMl: null });
    expect(costInsights({ title: "Açaí 300ml", priceCents: 1999 })).toMatchObject({ effectivePer100mlCents: null, feesAsProductMl: null, totalPerServingCents: null });
  });

  it("parses weights and servings", () => {
    expect(parseWeightG("Marmita 1,2 kg")).toBe(1200);
    expect(parseWeightG("Açaí 500ml")).toBeNull();
    expect(parseServings("Serve 2 pessoas")).toBe(2);
    expect(parseServings("Serve até 4 pessoas")).toBe(4);
    expect(parseServings("Delicioso")).toBeNull();
  });
});

describe("menuValue (tamanho que compensa)", () => {
  it("ranks a real menu by price per 100 ml and counts duplicate cards once", () => {
    const menu = menuValue([
      { title: "*Açaí + 2x Amendoim + 2x Leite Condensado 300ml", priceCents: 1999 },
      { title: "*Açaí + 2x Amendoim + 2x Leite Condensado 300ml", priceCents: 1999 },
      { title: "*Marmitex de Açaí 700ml", priceCents: 3199 },
      { title: "*Açaí + 2x Morangos Premium + 2x Leite em Pó 300ml", priceCents: 2099 },
      { title: "Água mineral", priceCents: 400 }
    ]);
    expect(menu.ranked.map((i) => i.pricePer100mlCents)).toEqual([457, 666, 700]);
    expect(menu.best?.volumeMl).toBe(700);
    expect(menu.spreadPct).toBe(34.7);
    expect(menu.unranked).toBe(1);
  });
});

describe("bulk formats (real menu, Açaí Godoi, 2026-10-10)", () => {
  it("keeps potes apart from cup sizes", () => {
    expect(isBulkFormat("Pote de açaí 5 litros", 5000)).toBe(true);
    expect(isBulkFormat("Pote de açaí 2 litros", 2000)).toBe(true);
    expect(isBulkFormat("Açaí 1 litro", 1000)).toBe(false);
    expect(isBulkFormat("Açaí Cremoso 300ml + 3 Complementos Grátis", 300)).toBe(false);
    const v = menuValue([
      { title: "Pote de açaí 5 litros", priceCents: 8791 },
      { title: "Pote de açaí 2 litros", priceCents: 4590 },
      { title: "Açaí Cremoso 300ml + 3 Complementos Grátis", priceCents: 876 },
      { title: "Açaí 500ml", priceCents: 1990 }
    ]);
    expect(v.best?.title).toBe("Açaí Cremoso 300ml + 3 Complementos Grátis");
    expect(v.ranked).toHaveLength(2);
    expect(v.bulkBest).toMatchObject({ title: "Pote de açaí 5 litros", pricePer100mlCents: 176 });
  });
});
