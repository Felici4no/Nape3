// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { detectPageContext } from "../src/content/context";
import { takeSnapshot } from "../src/content/extract";
import { extractCart } from "../src/content/extractors/cart";
import { extractPixPayment, parseExpiration } from "../src/content/extractors/pix";
import { extractProduct } from "../src/content/extractors/product";
import { extractRestaurant } from "../src/content/extractors/restaurant";

const URLS = {
  search: "https://www.ifood.com.br/busca?q=acai",
  restaurant: "https://www.ifood.com.br/delivery/sao-paulo-sp/acai-do-bairro-pinheiros/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab",
  product: "https://www.ifood.com.br/delivery/sao-paulo-sp/acai-do-bairro-pinheiros/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab?item=42",
  cart: "https://www.ifood.com.br/delivery/sao-paulo-sp/acai-do-bairro-pinheiros/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab",
  checkout: "https://www.ifood.com.br/pedido/finalizar",
  pix: "https://www.ifood.com.br/pedido/pagamento",
  confirmation: "https://www.ifood.com.br/pedidos/abc/acompanhar"
} as const;

function load(name: keyof typeof URLS): Document {
  const html = readFileSync(join(__dirname, "fixtures", `${name}.html`), "utf8");
  return new JSDOM(html, { url: URLS[name] }).window.document;
}

describe("detectPageContext", () => {
  it.each([
    ["search", "SEARCH_RESULTS"],
    ["restaurant", "RESTAURANT"],
    ["product", "PRODUCT"],
    ["cart", "CART"],
    ["checkout", "CHECKOUT"],
    ["pix", "PIX_PAYMENT"],
    ["confirmation", "ORDER_CONFIRMATION"]
  ] as const)("%s → %s", (name, expected) => {
    const detection = detectPageContext(load(name), URLS[name]);
    expect(detection.context).toBe(expected);
    expect(detection.signals.length).toBeGreaterThan(0);
  });

  it("returns UNKNOWN for unrelated pages", () => {
    const doc = new JSDOM("<html><body><p>Olá R$ 10,00</p></body></html>").window.document;
    expect(detectPageContext(doc, "https://www.ifood.com.br/").context).toBe("UNKNOWN");
  });

  it("detects the cart drawer even when the page is a restaurant page", () => {
    expect(detectPageContext(load("cart"), URLS.cart).context).toBe("CART");
  });
});

describe("extractCart", () => {
  it("binds each amount to its label inside the order summary (not the first R$ on the page)", () => {
    const cart = extractCart(load("cart"));
    expect(cart.itemsSubtotalCents.value).toBe(1590);
    expect(cart.deliveryFeeCents.value).toBe(499);
    expect(cart.serviceFeeCents.value).toBe(99);
    expect(cart.discountCents).toMatchObject({ value: 0, confidence: "low" });
    expect(cart.totalCents.value).toBe(2188);
    expect(cart.reconciliation).toEqual({ consistent: true, differenceCents: 0 });
    expect(cart.merchantName.value).toBe("Açaí do Bairro");
    expect(cart.lines).toEqual([
      expect.objectContaining({ sourceTitle: "Açaí 500ml Tradicional", quantity: 1, lineTotalCents: 1590 })
    ]);
  });

  it("handles struck-through prices, free delivery and coupons at checkout", () => {
    const checkout = extractCart(load("checkout"), "checkout");
    expect(checkout.itemsSubtotalCents.value).toBe(3180);
    expect(checkout.deliveryFeeCents).toMatchObject({ value: 0, confidence: "high" });
    expect(checkout.serviceFeeCents.value).toBe(99);
    expect(checkout.discountCents.value).toBe(500);
    expect(checkout.totalCents.value).toBe(2779);
    expect(checkout.reconciliation?.consistent).toBe(true);
    expect(checkout.lines[0]).toMatchObject({ quantity: 2, lineTotalCents: 3180 });
    expect(checkout.paymentMethod.value).toBe("pix");
    expect(checkout.eta.value).toEqual({ min: 25, max: 35 });
  });

  it("reports missing data instead of guessing when there is no summary", () => {
    const cart = extractCart(load("restaurant"));
    expect(cart.totalCents.value).toBeNull();
    expect(cart.totalCents.confidence).toBe("missing");
  });

  it("flags totals that do not reconcile", () => {
    const doc = load("cart");
    const total = Array.from(doc.querySelectorAll("span")).find((s) => s.textContent === "R$ 21,88")!;
    total.textContent = "R$ 22,88";
    const cart = extractCart(doc);
    expect(cart.reconciliation).toEqual({ consistent: false, differenceCents: 100 });
    expect(cart.validity.valid).toBe(false);
    expect(cart.validity.reasons[0]).toContain("reconciliation failed");
  });
});

describe("extractRestaurant / extractProduct", () => {
  it("reads the merchant from the page <h1>, not the first h2/h3", () => {
    const restaurant = extractRestaurant(load("restaurant"));
    expect(restaurant.merchantName.value).toBe("Açaí do Bairro");
    expect(restaurant.deliveryFeeCents.value).toBe(499);
    expect(restaurant.minimumOrderCents.value).toBe(2000);
    expect(restaurant.eta.value).toEqual({ min: 30, max: 40 });
  });

  it("scopes product extraction to the open dialog", () => {
    const product = extractProduct(load("product"));
    expect(product.title.value).toBe("Açaí 500ml Tradicional");
    expect(product.unitPriceCents.value).toBe(1590);
    expect(product.originalUnitPriceCents.value).toBe(1890);
  });
});

describe("extractPixPayment", () => {
  const now = new Date("2026-10-04T12:00:00Z");

  it("prefers the visible Copia e Cola payload and validates it", () => {
    const pix = extractPixPayment(load("pix"), now);
    expect(pix.preferredEvidence).toBe("pix-copy-paste");
    expect(pix.parsedPayload).toMatchObject({ crcValid: true, merchantName: "ACAI DO BAIRRO", txid: "PEDIDO123" });
    expect(pix.amountCents).toMatchObject({ value: 2779, confidence: "high" });
    expect(pix.qrCodePresent).toBe(true);
    expect(pix.pixKey.value).toBe("pagamentos@example.com");
    expect(pix.expiresAt.value).toBe("2026-10-04T12:29:30.000Z");
  });

  it("falls back to QR presence when no payload is visible", () => {
    const doc = load("pix");
    doc.querySelector("input")!.value = "";
    const pix = extractPixPayment(doc, now);
    expect(pix.preferredEvidence).toBe("qr-code");
    expect(pix.amountCents).toMatchObject({ value: 2779, confidence: "medium" });
  });

  it("parses expiration formats", () => {
    expect(parseExpiration("Expira em 30 minutos", now)).toBe("2026-10-04T12:30:00.000Z");
    expect(parseExpiration("sem prazo", now)).toBeNull();
  });
});

describe("read-only guarantee", () => {
  it.each(Object.keys(URLS) as Array<keyof typeof URLS>)("takeSnapshot does not mutate the %s page", (name) => {
    const doc = load(name);
    const before = doc.documentElement.outerHTML;
    takeSnapshot(doc, URLS[name]);
    expect(doc.documentElement.outerHTML).toBe(before);
  });

  it("snapshot never contains the page URL", () => {
    const snapshot = takeSnapshot(load("checkout"), "https://www.ifood.com.br/pedido/finalizar?token=secret");
    expect(JSON.stringify(snapshot)).not.toContain("secret");
    expect(snapshot.pageRef).toBe("ifood:checkout");
  });
});
