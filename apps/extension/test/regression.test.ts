// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { takeSnapshot } from "../src/content/extract";
import { extractCheckout } from "../src/content/extractors/cart";

const CHECKOUT_URL = "https://www.ifood.com.br/pedido/finalizar";
const load = (name: string, url = CHECKOUT_URL) =>
  new JSDOM(readFileSync(join(__dirname, "fixtures", `${name}.html`), "utf8"), { url }).window.document;

describe("regression: checkout with stale bag drawer still mounted", () => {
  it("reads the current checkout, not the previous cart state", () => {
    const cart = extractCheckout(load("checkout-stale-drawer"));
    expect(cart.lines).toEqual([expect.objectContaining({ quantity: 2, sourceTitle: "Açaí 500ml Tradicional", lineTotalCents: 3180 })]);
    expect(cart.itemsSubtotalCents.value).toBe(3180);
    expect(cart.deliveryFeeCents).toMatchObject({ value: 0, confidence: "high" });
    expect(cart.serviceFeeCents.value).toBe(99);
    expect(cart.discountCents).toMatchObject({ value: 500, confidence: "high" });
    expect(cart.totalCents.value).toBe(2779);
    expect(cart.validity).toEqual({ valid: true, reasons: [] });
  });

  it("produces R$27,79 through the full snapshot", () => {
    const snapshot = takeSnapshot(load("checkout-stale-drawer"), CHECKOUT_URL);
    expect(snapshot.detection.context).toBe("CHECKOUT");
    expect(snapshot.cart!.totalCents.value).toBe(2779);
  });
});

// --- requirements from the real-checkout calibration report ------------------

import { cents } from "@nape3/domain";
import { parseLineQuantity } from "../src/content/extractors/cart";
import { mergeObservation, snapshotToObservation } from "../src/shared/observation";
import { DEFAULT_SETTINGS } from "../src/shared/types";

function checkoutWith(summaryRows: string, item = "<li><span>2x</span> <span>Açaí 500ml Tradicional</span> <span>R$ 31,80</span></li>") {
  return new JSDOM(
    `<html><body><main><section><p>Seu pedido em Açaí do Bairro</p><ul>${item}</ul><div>${summaryRows}</div><button>Fazer pedido</button></section></main></body></html>`,
    { url: CHECKOUT_URL }
  ).window.document;
}
const row = (label: string, value: string) => `<div><span>${label}</span><span>${value}</span></div>`;

describe("calibration requirements", () => {
  it.each([
    ["2x Açaí", 2],
    ["2 x Açaí", 2],
    ["2× Açaí", 2],
    ["Açaí x2", 2],
    ["3 un. Açaí", 3],
    ["Açaí", null]
  ])("parses quantity in %s", (text, expected) => {
    expect(parseLineQuantity(text)).toBe(expected);
  });

  it("handles unit price shown next to the quantity", () => {
    const doc = checkoutWith(
      row("Subtotal", "R$ 31,80") + row("Taxa de entrega", "Grátis") + row("Taxa de serviço", "R$ 0,99") + row("Cupom", "-R$ 5,00") + row("Total", "R$ 27,79"),
      "<li><span>2x</span> <span>Açaí 500ml Tradicional</span> <span>R$ 15,90</span></li>"
    );
    const cart = extractCheckout(doc);
    expect(cart.lines[0]).toMatchObject({ quantity: 2, lineTotalCents: 3180 });
    expect(cart.validity.valid).toBe(true);
  });

  it.each(["Cupom", "Cupom IFOOD10", "Desconto do cupom", "Descontos"])("reads discount label %s → 500", (label) => {
    const doc = checkoutWith(
      row("Subtotal", "R$ 31,80") + row("Taxa de entrega", "Grátis") + row("Taxa de serviço", "R$ 0,99") + row(label, "−R$ 5,00") + row("Total", "R$ 27,79")
    );
    expect(extractCheckout(doc)).toMatchObject({ discountCents: { value: 500 }, totalCents: { value: 2779 }, validity: { valid: true } });
  });

  it("Grátis delivery becomes 0", () => {
    const doc = checkoutWith(row("Subtotal", "R$ 31,80") + row("Taxa de entrega", "Grátis") + row("Taxa de serviço", "R$ 0,99") + row("Cupom", "-R$ 5,00") + row("Total", "R$ 27,79"));
    expect(extractCheckout(doc).deliveryFeeCents).toMatchObject({ value: 0, confidence: "high" });
  });

  it("marks the quote invalid when reconciliation fails and refuses to record it", () => {
    // Coupon row missing from the DOM: 31,80 + 0 + 0,99 ≠ 27,79.
    const doc = checkoutWith(row("Subtotal", "R$ 31,80") + row("Taxa de entrega", "Grátis") + row("Taxa de serviço", "R$ 0,99") + row("Total", "R$ 27,79"));
    const snapshot = takeSnapshot(doc, CHECKOUT_URL);
    expect(snapshot.cart!.validity.valid).toBe(false);
    expect(snapshot.cart!.validity.reasons[0]).toBe(
      "reconciliation failed: subtotal R$31,80 + delivery R$0,00 + service R$0,99 − discount R$0,00 = R$32,79 ≠ total R$27,79"
    );
    const built = snapshotToObservation(snapshot, DEFAULT_SETTINGS, "observer-1");
    expect(built.ok).toBe(false);
  });

  it("refuses to choose between two on-screen summaries with different totals", () => {
    const doc = new JSDOM(
      `<html><body><div><div>${row("Subtotal", "R$ 15,90")}${row("Total", "R$ 21,88")}</div></div><div><div>${row("Subtotal", "R$ 31,80")}${row("Total", "R$ 27,79")}</div></div></body></html>`,
      { url: CHECKOUT_URL }
    ).window.document;
    const cart = extractCheckout(doc);
    expect(cart.validity.valid).toBe(false);
    expect(cart.validity.reasons[0]).toMatch(/^ambiguous: 2 order summaries/);
    expect(cart.totalCents.value).toBeNull();
  });

  it("recomputes after a SPA transition from the 1x bag to the 2x checkout", () => {
    const html = readFileSync(join(__dirname, "fixtures", "cart.html"), "utf8");
    const dom = new JSDOM(html, { url: "https://www.ifood.com.br/delivery/sao-paulo-sp/acai-do-bairro/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab" });
    const doc = dom.window.document;
    expect(takeSnapshot(doc, dom.window.location.href).cart!.totalCents.value).toBe(2188);

    const checkoutMain = /<main[\s\S]*<\/main>/.exec(readFileSync(join(__dirname, "fixtures", "checkout.html"), "utf8"))![0];
    dom.window.history.pushState({}, "", "/pedido/finalizar");
    doc.querySelector("main")!.outerHTML = checkoutMain; // bag drawer stays mounted

    const after = takeSnapshot(doc, dom.window.location.href);
    expect(after.detection.context).toBe("CHECKOUT");
    expect(after.cart).toMatchObject({
      itemsSubtotalCents: { value: 3180 },
      deliveryFeeCents: { value: 0 },
      serviceFeeCents: { value: 99 },
      discountCents: { value: 500 },
      totalCents: { value: 2779 },
      validity: { valid: true }
    });
    expect(after.cart!.lines[0]!.quantity).toBe(2);
  });

  it("retires the previous state of the same cart from storage", () => {
    const at = (iso: string) => takeSnapshot(load("checkout-stale-drawer"), CHECKOUT_URL, new Date(iso));
    const first = snapshotToObservation(
      takeSnapshot(load("cart", "https://www.ifood.com.br/delivery/sp/acai/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab"), "https://www.ifood.com.br/delivery/sp/acai/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab", new Date("2026-10-04T12:00:00Z")),
      DEFAULT_SETTINGS,
      "observer-1"
    );
    const second = snapshotToObservation(at("2026-10-04T12:05:00Z"), DEFAULT_SETTINGS, "observer-1");
    if (!first.ok || !second.ok) throw new Error("expected valid observations");
    const { next, superseded } = mergeObservation([first.observation], second.observation, 300);
    expect(superseded.map((o) => o.id)).toEqual([first.observation.id]);
    expect(next).toHaveLength(1);
    expect(next[0]!.kind === "cart-quote" && next[0]!.quote.totalCents).toBe(cents(2779));
  });
});

describe("real iFood bag drawer (modelled on user screenshot)", () => {
  const url = "https://www.ifood.com.br/delivery/sao-paulo-sp/adega-mk-delivery/d188a20e-aaaa-bbbb-cccc-1234567890ab";
  it("extracts R$78,55 and ignores the coupon picker", () => {
    const snapshot = takeSnapshot(load("cart-real-screenshot-skol", url), url);
    expect(snapshot.detection.context).toBe("CART");
    expect(snapshot.cart).toMatchObject({
      merchantName: { value: "Adega Mk Delivery - Adega e Tabacaria - 24h" },
      itemsSubtotalCents: { value: 6966 },
      serviceFeeCents: { value: 199 },
      deliveryFeeCents: { value: 690 },
      discountCents: { value: 0 },
      totalCents: { value: 7855 },
      validity: { valid: true }
    });
    expect(snapshot.cart!.lines).toEqual([
      expect.objectContaining({ quantity: 1, lineTotalCents: 6966, sourceTitle: "Cerveja Pilsen Lata Skol 269ml com 15un" })
    ]);
  });
});
