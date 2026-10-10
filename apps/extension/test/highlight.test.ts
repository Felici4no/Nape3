// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { extractMenu } from "../src/content/extractors/restaurant";
import { findCards, pickHighlights, renderHighlights, revealItem } from "../src/content/highlight";

const URL_R = "https://www.ifood.com.br/delivery/sao-paulo-sp/maranata-acai-cidade-lider/28dbb602-58b9-4a3c-a1c1-812533f2b12f";
const load = () => new JSDOM(readFileSync(join(__dirname, "fixtures/restaurant-real-menu.html"), "utf8"), { url: URL_R }).window.document;

describe("menu highlights (real Maranata menu cards)", () => {
  it("marks the best per litre and the agent's pick", () => {
    const doc = load();
    const menu = extractMenu(doc.body);
    const picks = pickHighlights(menu, { merchantKey: "x", title: "*Açaí + 2x Morangos Premium + 2x Leite em Pó 300ml", priceCents: 2099, estimatedTotalCents: 2797, at: "" });
    expect(picks[0]).toMatchObject({ tone: "agent", title: "*Açaí + 2x Morangos Premium + 2x Leite em Pó 300ml" });
    expect(picks[0]!.label).toContain("Recomendado");
    expect(picks).toContainEqual(expect.objectContaining({ tone: "best", title: "*Marmitex de Açaí 700ml" }));
  });

  it("finds every visible card of an item (carousel repeats) and draws one overlay", () => {
    const doc = load();
    expect(findCards(doc, "*Açaí + 2x Amendoim + 2x Leite Condensado 300ml", 1999)).toHaveLength(2);
    expect(findCards(doc, "*Marmitex de Açaí 700ml", 1999)).toHaveLength(0);
    renderHighlights(doc, pickHighlights(extractMenu(doc.body)));
    expect(doc.querySelectorAll("upay3food-highlights")).toHaveLength(1);
    // iFood's own nodes are untouched: the cards have no attribute or child added.
    expect(doc.querySelector('a.dish-card')!.outerHTML).not.toContain("upay3food");
    expect(revealItem(doc, "*Marmitex de Açaí 700ml", 3199)).toBe(true);
    expect(revealItem(doc, "Item que não existe", 100)).toBe(false);
  });
});
