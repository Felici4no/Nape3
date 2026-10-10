import { describe, expect, it } from "vitest";
import { comboPremiums, readBurger } from "./burger";
import { menuValue } from "./insights";

describe("readBurger", () => {
  it("reads meat grams, patties, type and cut", () => {
    expect(readBurger("Smash Duplo 2x 90g")).toMatchObject({ meatGrams: 180, patties: 2, meatType: "bovino", cut: "smash", isCombo: false });
    expect(readBurger("Burger de Costela 180g")).toMatchObject({ meatGrams: 180, patties: 1, meatType: "bovino", cut: "costela" });
    expect(readBurger("Chicken Crispy 150g")).toMatchObject({ meatGrams: 150, meatType: "frango" });
    expect(readBurger("Futuro Burger Vegano 113g")).toMatchObject({ meatGrams: 113, meatType: "vegetal" });
    expect(readBurger("X-Salada")).toMatchObject({ meatGrams: null, meatType: null });
  });

  it("detects combos and their extras", () => {
    expect(readBurger("Combo Burger de Costela 180g + Batata + Refri")).toMatchObject({ isCombo: true, comboExtras: ["batata", "refri"] });
  });
});

describe("comboPremiums", () => {
  it("prices what the combo adds over the standalone burger", () => {
    const premiums = comboPremiums([
      { title: "Burger de Costela 180g", priceCents: 3290 },
      { title: "Combo Burger de Costela 180g + Batata + Refri", priceCents: 4490 },
      { title: "Smash Duplo 2x 90g", priceCents: 2790 }
    ]);
    expect(premiums).toEqual([
      { combo: "Combo Burger de Costela 180g + Batata + Refri", standalone: "Burger de Costela 180g", extrasCents: 1200, extras: ["batata", "refri"] }
    ]);
  });
});

describe("menuValue by meat", () => {
  it("ranks burgers per 100 g of meat", () => {
    const v = menuValue(
      [
        { title: "Smash Duplo 2x 90g", priceCents: 2790 },
        { title: "Burger de Costela 180g", priceCents: 3290 },
        { title: "Cheddar 120g", priceCents: 2490 },
        { title: "X-Salada", priceCents: 1990 }
      ],
      "meat"
    );
    expect(v.ranked.map((i) => [i.title, i.pricePer100mlCents])).toEqual([
      ["Smash Duplo 2x 90g", 1550],
      ["Burger de Costela 180g", 1828],
      ["Cheddar 120g", 2075]
    ]);
    expect(v.unranked).toBe(1);
  });
});
