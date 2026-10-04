import { describe, expect, it } from "vitest";
import { parseIntent } from "./intent";

function ok(request: string) {
  const result = parseIntent(request);
  if (!result.ok) throw new Error(result.reason);
  return result.intent;
}

describe("parseIntent", () => {
  it("parses the canonical example", () => {
    const intent = ok("quero um açaí 500ml até 25 reais");
    expect(intent.product).toEqual({ category: "acai", volumeMl: 500, quantity: 1 });
    expect(intent.budget).toEqual({ currency: "BRL", maxCents: 2500 });
    expect(intent.preferences).toEqual({ priceWeight: 0.8, etaWeight: 0.2 });
    expect(intent.execution.requireConfirmation).toBe(true);
    expect(intent.parsing.method).toBe("deterministic");
    expect(intent.parsing.missing).toEqual([]);
  });

  it("does not invent a target budget", () => {
    expect(ok("quero açaí até R$25").budget.targetCents).toBeUndefined();
    expect(ok("açaí 500ml até 25, idealmente 20 reais").budget).toEqual({
      currency: "BRL",
      maxCents: 2500,
      targetCents: 2000
    });
  });

  it.each([
    ["quero açaí até R$25", 2500],
    ["açaí no máximo 22,50", 2250],
    ["açaí por menos de 20 reais", 1999],
    ["açaí 500ml por R$ 19,90", 1990]
  ])("budget: %s → %d", (request, max) => {
    expect(ok(request).budget.maxCents).toBe(max);
  });

  it("reports missing volume and budget instead of guessing", () => {
    const intent = ok("quero um açaí");
    expect(intent.product.volumeMl).toBeUndefined();
    expect(intent.parsing.missing).toEqual(["product.volumeMl", "budget.maxCents"]);
  });

  it("parses quantity and volume variants", () => {
    expect(ok("dois açaís de 0,5L até 50").product).toEqual({ category: "acai", volumeMl: 500, quantity: 2 });
    expect(ok("2 acai 300ml").product.quantity).toBe(2);
  });

  it("adjusts weights for speed and price preferences", () => {
    expect(ok("açaí 500ml urgente").preferences).toEqual({ priceWeight: 0.4, etaWeight: 0.6 });
    expect(ok("açaí 500ml mais barato").preferences.priceWeight).toBe(0.95);
  });

  it("refuses unsupported categories", () => {
    const result = parseIntent("quero uma pizza grande");
    expect(result.ok).toBe(false);
  });
});
