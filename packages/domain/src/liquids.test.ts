import { describe, expect, it } from "vitest";
import { drinkUnits, liquidKind, liquidValue } from "./liquids";

describe("liquids", () => {
  it("classifies drinks and counts packs", () => {
    expect(liquidKind("Cerveja Pilsen Lata Skol 269ml com 15un")).toBe("cerveja");
    expect(liquidKind("Coca-Cola 2L")).toBe("refrigerante");
    expect(liquidKind("Suco de laranja 500ml")).toBe("suco");
    expect(liquidKind("Água mineral 500ml")).toBe("agua");
    expect(liquidKind("*Açaí + 2x Amendoim 300ml")).toBe("acai");
    expect(drinkUnits("Cerveja Pilsen Lata Skol 269ml com 15un")).toBe(15);
    expect(drinkUnits("Guaraná 6x350ml")).toBe(6);
    expect(drinkUnits("Fardo 12 Heineken 350ml")).toBe(12);
    expect(drinkUnits("Coca-Cola 2L")).toBe(1);
  });

  it("ranks per litre within each kind, never across kinds", () => {
    const groups = liquidValue([
      { title: "Coca-Cola Lata 350ml", priceCents: 700 },
      { title: "Coca-Cola 2L", priceCents: 1400 },
      { title: "Cerveja Pilsen Lata Skol 269ml com 15un", priceCents: 5990 },
      { title: "Cerveja Heineken Long Neck 330ml", priceCents: 990 },
      { title: "*Açaí + 2x Amendoim 300ml", priceCents: 1999 },
      { title: "Pote de açaí 5 litros", priceCents: 8791 }
    ]);
    const refri = groups.find((g) => g.kind === "refrigerante")!;
    expect(refri.ranked.map((i) => [i.title, i.pricePerLiterCents])).toEqual([
      ["Coca-Cola 2L", 700],
      ["Coca-Cola Lata 350ml", 2000]
    ]);
    expect(refri.spreadPct).toBe(65);
    const cerveja = groups.find((g) => g.kind === "cerveja")!;
    expect(cerveja.ranked[0]).toMatchObject({ units: 15, totalMl: 4035, pricePerLiterCents: 1485 });
    const acai = groups.find((g) => g.kind === "acai")!;
    expect(acai.ranked).toHaveLength(1);
    expect(acai.ranked[0]!.units).toBe(1);
    expect(acai.bulkBest?.title).toBe("Pote de açaí 5 litros");
  });
});
