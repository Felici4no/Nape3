import { describe, expect, it } from "vitest";
import { acaiFixtures } from "@nape3/fixtures";
import { sanitizeObservation } from "./sanitize";

const cart = acaiFixtures().find((o) => o.id === "fx-ifood-1")!;

describe("sanitizeObservation", () => {
  it("round-trips a valid observation", () => {
    const result = sanitizeObservation(JSON.parse(JSON.stringify(cart)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.observation.kind).toBe("cart-quote");
  });

  it("drops unknown fields such as cookies, tokens and addresses by construction", () => {
    const hostile = {
      ...JSON.parse(JSON.stringify(cart)),
      cookies: "session=abc",
      authorization: "Bearer xyz",
      deliveryAddress: "Rua X, 123",
      context: { ...cart.context, customerName: "Fulano" }
    };
    const result = sanitizeObservation(hostile);
    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result.ok && result.observation);
    for (const secret of ["session=abc", "Bearer", "Rua X", "Fulano"]) expect(serialized).not.toContain(secret);
  });

  it("keeps the restaurant's public path and id, and drops anything else in it", () => {
    const id = "2b1c6f7e-3d4a-4b5c-9d8e-1f2a3b4c5d6e";
    const ok = JSON.parse(JSON.stringify(cart));
    ok.quote.merchant = { name: "Maranata Açaí", sourceMerchantId: id, sourcePath: `/delivery/sao-paulo-sp/maranata-acai/${id}` };
    const kept = sanitizeObservation(ok);
    expect(kept.ok && kept.observation.kind === "cart-quote" && kept.observation.quote.merchant).toEqual(ok.quote.merchant);
    const bad = JSON.parse(JSON.stringify(cart));
    bad.quote.merchant = { name: "X", sourcePath: `/delivery/sao-paulo-sp/x/${id}?token=abc` };
    const dropped = sanitizeObservation(bad);
    expect(dropped.ok && dropped.observation.kind === "cart-quote" && dropped.observation.quote.merchant.sourcePath).toBeUndefined();
  });

  it("scrubs e-mails and phone numbers from free text", () => {
    const input = JSON.parse(JSON.stringify(cart));
    input.quote.merchant.name = "Loja fulano@mail.com +55 (11) 98888-7777";
    const result = sanitizeObservation(input);
    expect(result.ok && result.observation.kind === "cart-quote" && result.observation.quote.merchant.name).toBe(
      "Loja [removed] [removed]"
    );
  });

  it("rejects floats, fine-grained locations, URLs and contradictory provenance", () => {
    const floats = JSON.parse(JSON.stringify(cart));
    floats.quote.totalCents = 21.88;
    expect(sanitizeObservation(floats).ok).toBe(false);

    const precise = JSON.parse(JSON.stringify(cart));
    precise.context.marketRegion = "01310-100";
    expect(sanitizeObservation(precise).ok).toBe(false);

    const mixed = JSON.parse(JSON.stringify(cart));
    mixed.provenance = { method: "fixture", live: true, synthetic: false };
    const result = sanitizeObservation(mixed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain("synthetic");

    const url = JSON.parse(JSON.stringify(cart));
    url.provenance.rawReference = "https://www.ifood.com.br/?token=abc";
    const cleaned = sanitizeObservation(url);
    expect(cleaned.ok && cleaned.observation.provenance.rawReference).toBeFalsy();
  });

  it("recomputes normalization instead of trusting the client", () => {
    const input = JSON.parse(JSON.stringify(cart));
    input.quote.lines[0].product = { category: "acai", volumeMl: 9999, attributes: {}, normalization: {} };
    const result = sanitizeObservation(input);
    expect(result.ok && result.observation.kind === "cart-quote" && result.observation.quote.lines[0]!.product?.volumeMl).toBe(500);
  });
});
