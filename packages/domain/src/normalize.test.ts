import { describe, expect, it } from "vitest";
import { areEquivalent, matchesRequirement, normalizeTitle } from "./normalize";
import { parsePackQuantity, parseVolumeMl } from "./volume";

describe("parseVolumeMl", () => {
  it.each([
    ["Açaí 500ml", 500],
    ["Açaí 500 ml tradicional", 500],
    ["AÇAÍ 500 ML", 500],
    ["Copo de açaí 0,5 L", 500],
    ["Açaí 0.5l", 500],
    ["Açaí 1 litro", 1000],
    ["Barca de açaí 1,5L", 1500],
    ["Açaí meio litro", 500],
    ["Açaí 300 mL com granola", 300]
  ])("%s → %d", (title, expected) => {
    expect(parseVolumeMl(title)).toBe(expected);
  });

  it("does not confuse grams or bare numbers with volume", () => {
    expect(parseVolumeMl("Açaí 500g")).toBeNull();
    expect(parseVolumeMl("Açaí tamanho 2")).toBeNull();
  });

  it("parses pack quantity", () => {
    expect(parsePackQuantity("Combo 2 açaís 500ml")).toBe(2);
    expect(parsePackQuantity("2x Açaí 300ml")).toBe(2);
    expect(parsePackQuantity("Açaí 500ml")).toBe(1);
  });
});

describe("normalizeTitle", () => {
  it("normalizes açaí with volume", () => {
    const { product } = normalizeTitle("Açaí Tradicional 500ml no copo");
    expect(product).toMatchObject({ category: "acai", volumeMl: 500, attributes: { format: "copo" } });
    expect(product!.normalization.confidence).toBeGreaterThan(0.9);
    expect(product!.normalization.method).toBe("deterministic");
  });

  it("keeps low confidence when volume is missing", () => {
    const { product } = normalizeTitle("Açaí da casa");
    expect(product!.volumeMl).toBeUndefined();
    expect(product!.normalization.confidence).toBeLessThan(0.5);
  });

  it("rejects non-comparable açaí products with a reason", () => {
    expect(normalizeTitle("Polpa de açaí 1kg").product).toBeNull();
    expect(normalizeTitle("Picolé de açaí").product).toBeNull();
    expect(normalizeTitle("Hambúrguer artesanal").product).toBeNull();
  });
});

describe("equivalence", () => {
  const a500 = normalizeTitle("Açaí 500ml").product;
  const b500 = normalizeTitle("Copo Açaí 0,5L c/ banana").product;
  const c300 = normalizeTitle("Açaí 300ml").product;
  const combo = normalizeTitle("Combo 2 açaís 500ml").product;
  const unknown = normalizeTitle("Açaí da casa").product;

  it("matches equal category and volume across naming conventions", () => {
    expect(areEquivalent(a500, b500).equivalent).toBe(true);
  });

  it("rejects different volume, packs and unknown volume", () => {
    expect(areEquivalent(a500, c300).equivalent).toBe(false);
    expect(areEquivalent(a500, combo).equivalent).toBe(false);
    expect(areEquivalent(a500, unknown).equivalent).toBe(false);
  });

  it("checks requirements", () => {
    expect(matchesRequirement(b500, { category: "acai", volumeMl: 500 }).equivalent).toBe(true);
    const res = matchesRequirement(c300, { category: "acai", volumeMl: 500 });
    expect(res.equivalent).toBe(false);
    expect(res.reasons[0]).toContain("300");
  });
});
