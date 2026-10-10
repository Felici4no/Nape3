import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { advise, compareBags, itemCost, parseIfoodLink, priceBreakdown, rankMenu, readBagFromText, readMenuFromText } from "./agent-tools";

const SHOP = "https://www.ifood.com.br/delivery/sao-paulo-sp/maranata-acai-cidade-lider/28dbb602-58b9-4a3c-a1c1-812533f2b12f";

describe("agent tools (reais in, reais out)", () => {
  it("price breakdown of a real bag", () => {
    expect(priceBreakdown({ food_brl: 31.99, delivery_fee_brl: 0, service_fee_brl: 0.99, total_brl: 32.98 })).toMatchObject({
      layers: { food_brl: 31.99, fees_brl: 0.99, difference_brl: null },
      total_brl: 32.98,
      fee_share_pct: 3,
      estimated: false
    });
  });

  it("item cost views", () => {
    expect(itemCost({ title: "*Marmitex de Açaí 700ml", price_brl: 31.99, original_price_brl: 57.9, fees_brl: 7.98 })).toMatchObject({
      volume_ml: 700,
      price_per_liter_brl: 45.7,
      real_price_per_100ml_with_fees_brl: 5.71,
      fees_as_product_ml: 175,
      shown_discount_pct: 44.7,
      burger: null
    });
    expect(itemCost({ title: "Smash Duplo 2x 90g", price_brl: 27.9 }).burger).toMatchObject({ meat_g: 180, patties: 2, meat_type: "bovino" });
  });

  it("ranks a menu and drinks", () => {
    const r = rankMenu({ items: [{ title: "*Marmitex de Açaí 700ml", price_brl: 31.99 }, { title: "Açaí 300ml", price_brl: 19.99 }, { title: "Coca-Cola 2L", price_brl: 14 }, { title: "Coca-Cola Lata 350ml", price_brl: 7 }] });
    expect(r.kind).toBe("acai");
    expect(r.ranked?.[0]).toMatchObject({ title: "*Marmitex de Açaí 700ml", price_per_100_brl: 4.57 });
    expect(r.drinks[0]).toMatchObject({ kind: "refrigerante" });
  });

  it("reads iFood links and drops everything but the path and item id", () => {
    expect(parseIfoodLink(`${SHOP}?prato=9b2f4c1e-7a3d-4e5f-8a6b-1c2d3e4f5a6b&token=secret`)).toEqual({
      ok: true,
      platform: "ifood",
      city: "sao-paulo-sp",
      shop_slug: "maranata-acai-cidade-lider",
      shop_id: "28dbb602-58b9-4a3c-a1c1-812533f2b12f",
      item_id: "9b2f4c1e-7a3d-4e5f-8a6b-1c2d3e4f5a6b",
      shop_url: SHOP
    });
    expect(parseIfoodLink("https://evil.example/delivery/a/b/c").ok).toBe(false);
  });

  it("advises from menus an agent read, linking to the item", () => {
    const out = advise({
      request: "quero açaí 500ml até R$30",
      now: new Date("2026-10-10T12:00:00Z"),
      menus: [
        { merchant_name: "Maranata Açaí", merchant_url: SHOP, delivery_fee_brl: 6.99, items: [{ title: "Açaí 500ml", price_brl: 21.99, item_url: `${SHOP}?prato=9b2f4c1e-7a3d-4e5f-8a6b-1c2d3e4f5a6b` }] }
      ]
    });
    expect(out.ok && out.best_for_request).toMatchObject({ estimated_total_brl: 29.97, link: `${SHOP}?prato=9b2f4c1e-7a3d-4e5f-8a6b-1c2d3e4f5a6b` });
    expect(advise({ request: "quero um carro", menus: [] }).ok).toBe(false);
  });
});

describe("text tools", () => {
  const text = readFileSync(join(__dirname, "../../../../packages/domain/src/__fixtures__/maranata-menu-text.txt"), "utf8");

  it("reads a real shop page text into a menu that advise accepts", () => {
    const r = readMenuFromText({ text, shop_name: "Maranata Açaí", shop_url: SHOP });
    expect(r.menu.delivery_fee_brl).toBe(6.99);
    expect(r.items_read).toBeGreaterThanOrEqual(15);
    expect(r.summary?.kind).toBe("acai");
    const out = advise({ request: "quero açaí 300ml até R$30", menus: [r.menu], now: new Date() });
    expect(out.ok && out.best_for_request).toMatchObject({ shop: "Maranata Açaí", estimated_total_brl: 27.97 });
  });

  it("reads a bag and compares bags", () => {
    const bag = readBagFromText({ text: "1x Açaí 500ml R$ 22,90\nSubtotal R$ 22,90\nTaxa de entrega Grátis\nTaxa de serviço R$ 0,99\nTotal R$ 23,89" });
    expect(bag).toMatchObject({ reconciles: true, breakdown: { total_brl: 23.89, fee_share_pct: 4.1 } });
    const c = compareBags({
      bags: [
        { label: "Loja A", food_brl: 22.9, delivery_fee_brl: 0, service_fee_brl: 0.99, total_brl: 23.89 },
        { label: "Loja B", food_brl: 19.99, delivery_fee_brl: 6.99, service_fee_brl: 0.99, total_brl: 27.97 }
      ]
    });
    expect(c.best.label).toBe("Loja A");
    expect(c.spread_brl).toBe(4.08);
    expect(c.bags[1]!.layers.difference_brl).toBe(4.08);
  });
});
