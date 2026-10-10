import { describe, expect, it } from "vitest";
import { adviseFromMenus, type MenuObservation } from "./menu-advisor";
import { parseIntent } from "./intent";

const NOW = new Date("2026-10-10T12:00:00Z");
const intent = (text: string) => {
  const r = parseIntent(text);
  if (!r.ok) throw new Error(r.reason);
  return r.intent;
};

const maranata: MenuObservation = {
  merchant: { name: "Maranata Açaí", platformId: "28dbb602-58b9-4a3c-a1c1-812533f2b12f" },
  source: "ifood",
  observedAt: "2026-10-10T11:40:00Z",
  deliveryFeeCents: 699,
  items: [
    { title: "*Açaí + 2x Amendoim + 2x Leite Condensado 300ml", priceCents: 1999 },
    { title: "*Marmitex de Açaí 700ml", priceCents: 3199 },
    { title: "Água mineral 500ml", priceCents: 400 }
  ]
};
const outra: MenuObservation = {
  merchant: { name: "Açaí do Bairro" },
  source: "ifood",
  observedAt: "2026-10-10T11:00:00Z",
  deliveryFeeCents: 0,
  items: [
    { title: "Açaí 500ml tradicional", priceCents: 2290 },
    { title: "Açaí 300ml", priceCents: 1590 }
  ]
};

describe("adviseFromMenus", () => {
  it("finds the cheapest estimated checkout for the asked size and the best price per litre", () => {
    const advice = adviseFromMenus(intent("quero açaí 500ml até R$30"), [maranata, outra], { now: NOW });
    expect(advice.bestForRequest).toMatchObject({ merchantName: "Açaí do Bairro", title: "Açaí 500ml tradicional", estimatedTotalCents: 2389 });
    // 700 ml is the best per litre, but its estimated total (R$39,97) is over the budget.
    expect(advice.bestValue).toMatchObject({ title: "*Marmitex de Açaí 700ml", pricePer100Cents: 457 });
    expect(advice.bestValueOverBudget).toBe(true);
    expect(advice.itemsConsidered).toBe(4);
    expect(advice.reasoning.join(" ")).toMatch(/confirme na sacola/);
  });

  it("without a budget, shows that the bigger size is cheaper per litre", () => {
    const advice = adviseFromMenus(intent("quero açaí 500ml"), [maranata, outra], { now: NOW });
    expect(advice.bestValue).toMatchObject({ title: "*Marmitex de Açaí 700ml", pricePer100Cents: 457 });
  });

  it("ignores stale menus and unknown delivery fees for totals", () => {
    const stale = { ...outra, observedAt: "2026-10-08T10:00:00Z" };
    const unknownFee = { ...maranata, deliveryFeeCents: null };
    const advice = adviseFromMenus(intent("quero açaí 300ml"), [stale, unknownFee], { now: NOW });
    expect(advice.shopsConsidered).toBe(1);
    expect(advice.bestForRequest).toBeNull();
    expect(advice.candidates[0]!.estimatedTotalCents).toBeNull();
  });

  it("ranks burgers per 100 g of meat", () => {
    const burgers: MenuObservation = {
      merchant: { name: "Smash Bros" },
      source: "ifood",
      observedAt: "2026-10-10T11:30:00Z",
      deliveryFeeCents: 500,
      items: [
        { title: "Smash Duplo 2x 90g", priceCents: 2790 },
        { title: "Burger de Costela 180g", priceCents: 3290 },
        { title: "Batata frita", priceCents: 1200 }
      ]
    };
    const advice = adviseFromMenus(intent("quero hamburguer até R$40"), [burgers], { now: NOW });
    expect(advice.bestValue).toMatchObject({ title: "Smash Duplo 2x 90g", unit: "g carne", amount: 180, pricePer100Cents: 1550 });
    expect(advice.bestForRequest).toMatchObject({ title: "Smash Duplo 2x 90g", estimatedTotalCents: 3389 });
  });
});

describe("adviseFromMenus on a real menu with potes (Açaí Godoi, 2026-10-10)", () => {
  const godoi: MenuObservation = {
    merchant: { name: "Açaí Godoi", path: "/delivery/sao-paulo-sp/acai-godoi/11111111-2222-4333-8444-555555555555" },
    source: "ifood",
    observedAt: "2026-10-10T11:50:00Z",
    deliveryFeeCents: 0,
    items: [
      { title: "Pote de açaí 5 litros", priceCents: 8791 },
      { title: "Pote de açaí 2 litros", priceCents: 4590 },
      { title: "Açaí Cremoso 300ml + 3 Complementos Grátis", priceCents: 876, itemId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
      { title: "Açaí 700ml", priceCents: 2690 }
    ]
  };

  it("keeps potes out, offers the nearest cup size within budget, links to the item", () => {
    const advice = adviseFromMenus(intent("quero açaí 500ml até R$25"), [godoi], { now: NOW });
    expect(advice.bestForRequest).toBeNull();
    expect(advice.bestValue?.title).toBe("Açaí Cremoso 300ml + 3 Complementos Grátis");
    expect(advice.nearest).toMatchObject({ title: "Açaí Cremoso 300ml + 3 Complementos Grátis", estimatedTotalCents: 975 });
    expect(advice.nearest?.itemUrl).toBe("https://www.ifood.com.br/delivery/sao-paulo-sp/acai-godoi/11111111-2222-4333-8444-555555555555?prato=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    expect(advice.bulkBest).toMatchObject({ title: "Pote de açaí 5 litros", bulk: true });
  });

  it("lets potes compete when a bulk size is asked", () => {
    const advice = adviseFromMenus(intent("quero açaí 2 litros até R$60"), [godoi], { now: NOW });
    expect(advice.bestForRequest?.title).toBe("Pote de açaí 2 litros");
  });
});
