import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readBagText, readMenuText } from "./text-readers";

describe("readMenuText on the real Maranata Açaí page text (2026-10-10)", () => {
  const reading = readMenuText(readFileSync(join(__dirname, "__fixtures__/maranata-menu-text.txt"), "utf8"));

  it("reads the delivery fee and the menu items with current and struck prices", () => {
    expect(reading.deliveryFeeBrl).toBe(6.99);
    expect(reading.items).toContainEqual({ title: "*Marmitex de Açaí 700ml", priceBrl: 31.99, originalPriceBrl: 57.9, servingsText: null });
    expect(reading.items).toContainEqual({ title: "*Monte o seu Açaí 300ml + 4 acompanhamentos", priceBrl: 24.99, originalPriceBrl: 35, servingsText: "Serve 1 pessoa" });
    expect(reading.items).toContainEqual({ title: "*Açaí + 2x Banana + 2x Granola 300ml", priceBrl: 19.99, originalPriceBrl: null, servingsText: "Serve 1 pessoa" });
    expect(reading.items.length).toBeGreaterThanOrEqual(15);
    // Section headers ("Açaí com Frutas!") never become titles.
    expect(reading.items.some((i) => /^açaí (com|sem) frutas!$/i.test(i.title))).toBe(false);
  });
});

describe("readBagText", () => {
  it("reads a real bag as text and checks it adds up", () => {
    const bag = readBagText(["Sua sacola", "Maranata Açaí", "1x *Marmitex de Açaí 700ml R$ 31,99", "Subtotal", "R$ 31,99", "Taxa de entrega", "Grátis", "Taxa de serviço ?", "R$ 0,99", "Total", "R$ 32,98"].join("\n"));
    expect(bag).toMatchObject({ subtotalBrl: 31.99, deliveryFeeBrl: 0, serviceFeeBrl: 0.99, totalBrl: 32.98, reconciles: true });
    expect(bag.lines).toEqual([{ quantity: 1, title: "*Marmitex de Açaí 700ml", totalBrl: 31.99 }]);
  });

  it("flags a total that does not add up", () => {
    expect(readBagText("Subtotal R$ 20,00\nTaxa de entrega R$ 5,00\nTotal R$ 30,00").reconciles).toBe(false);
  });
});
