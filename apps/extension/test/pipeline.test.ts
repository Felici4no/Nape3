// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { planPurchase } from "@nape3/agent";
import { acaiFixtures } from "@nape3/fixtures";
import { compareCheckout, summarizeMarket } from "@nape3/market";
import { takeSnapshot } from "../src/content/extract";
import { requirementFromObservation, snapshotToObservation } from "../src/shared/observation";
import { DEFAULT_SETTINGS } from "../src/shared/types";

const now = new Date("2026-10-04T12:00:00Z");

function snapshotOf(name: string, url: string) {
  const html = readFileSync(join(__dirname, "fixtures", `${name}.html`), "utf8");
  return takeSnapshot(new JSDOM(html, { url }).window.document, url, now);
}

describe("checkout → observation → market → agent", () => {
  const snapshot = snapshotOf("cart", "https://www.ifood.com.br/delivery/sao-paulo-sp/acai-do-bairro/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab");
  const settings = { ...DEFAULT_SETTINGS, marketRegion: "BR-SP-sao-paulo" };
  const built = snapshotToObservation(snapshot, settings, "11111111-2222-3333-4444-555555555555");

  it("builds a live, non-synthetic, sanitized observation", () => {
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.observation.provenance).toMatchObject({ method: "browser-extension", live: true, synthetic: false, rawReference: "ifood:cart" });
    expect(built.observation.quote).toMatchObject({ itemsSubtotalCents: 1590, deliveryFeeCents: 499, serviceFeeCents: 99, discountCents: 0, totalCents: 2188 });
    expect(built.observation.context).toMatchObject({ marketRegion: "BR-SP-sao-paulo", membership: "unknown", promotionScope: "none" });
    expect(JSON.stringify(built.observation)).not.toContain("ifood.com.br");
  });

  it("compares the checkout with fixture observations using observational language", () => {
    if (!built.ok) throw new Error(built.reason);
    const target = requirementFromObservation(built.observation)!;
    expect(target).toEqual({ requirement: { category: "acai", volumeMl: 500 }, quantity: 1 });
    const summary = summarizeMarket(acaiFixtures(now), {
      ...target,
      now,
      provenance: "include-synthetic",
      marketRegion: "BR-SP-sao-paulo",
      excludeIds: [built.observation.id]
    });
    const comparison = compareCheckout(built.observation.quote.totalCents, summary);
    expect(comparison.message).toContain("Your checkout is R$21,88.");
    expect(comparison.message).toContain("Includes synthetic fixture data.");
  });

  it("recommends with explanation and keeps the current checkout as the only executable option", () => {
    if (!built.ok) throw new Error(built.reason);
    const plan = planPurchase("quero açaí até R$25", acaiFixtures(now), {
      now,
      policy: { provenance: "include-synthetic", marketRegion: "BR-SP-sao-paulo", observerId: "11111111-2222-3333-4444-555555555555" },
      currentCheckout: built.observation
    });
    expect(plan.intent.ok && plan.intent.intent.parsing.missing).toEqual(["product.volumeMl"]);
    expect(plan.agent.state).toBe("USER_CONFIRMATION");
    expect(plan.decision!.bestExecutable!.observationId).toBe(built.observation.id);
    expect(plan.decision!.selected!.executability.executable).toBe(false);
    expect(plan.decision!.savings.vsCurrentCheckoutCents).toBe(2188 - 1690);
  });

  it("refuses to record when required fields are missing", () => {
    const restaurant = snapshotOf("restaurant", "https://www.ifood.com.br/delivery/sao-paulo-sp/acai-do-bairro/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab");
    const result = snapshotToObservation(restaurant, settings, "x");
    expect(result.ok).toBe(false);
  });
});
