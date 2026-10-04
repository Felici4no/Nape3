import { describe, expect, it } from "vitest";
import { cents, type CartQuoteObservation } from "@nape3/domain";
import { acaiFixtures, FIXTURE_NOW } from "@nape3/fixtures";
import { decide } from "./decision";
import { parseIntent } from "./intent";

const fixtures = acaiFixtures();
const intentOf = (text: string) => {
  const r = parseIntent(text);
  if (!r.ok) throw new Error(r.reason);
  return r.intent;
};
const intent = intentOf("quero um açaí 500ml até 25 reais");
const syntheticPolicy = { provenance: "include-synthetic" as const, marketRegion: "BR-SP-sao-paulo" };

describe("decide — hard constraints", () => {
  const decision = decide(intent, fixtures, { now: FIXTURE_NOW, policy: syntheticPolicy });
  const reason = (id: string) => decision.rejected.find((r) => r.observationId === id)?.rejections.join("; ");

  it("rejects over-budget, wrong volume, extra items, stale, item-only and other regions", () => {
    expect(reason("fx-ifood-premium")).toContain("exceeds max budget R$25,00");
    expect(reason("fx-ifood-300")).toContain("300 ml");
    expect(reason("fx-rappi-extra")).toContain("Água");
    expect(reason("fx-ifood-stale")).toMatch(/^stale/);
    expect(reason("fx-99food-item")).toContain("item-only");
    expect(reason("fx-99food-rj")).toContain("other region");
  });

  it("never ranks synthetic data under the default real-only policy", () => {
    const real = decide(intent, fixtures, { now: FIXTURE_NOW });
    expect(real.status).toBe("no-valid-option");
    expect(real.selected).toBeNull();
    expect(real.reasoning.at(-1)).toBe("No valid option. Nothing is recommended.");
  });

  it("returns no-valid-option when the budget is too low", () => {
    const tight = decide(intentOf("açaí 500ml até 10 reais"), fixtures, { now: FIXTURE_NOW, policy: syntheticPolicy });
    expect(tight.status).toBe("no-valid-option");
  });
});

describe("decide — ranking", () => {
  const decision = decide(intent, fixtures, { now: FIXTURE_NOW, policy: syntheticPolicy });

  it("ranks on cart total with an explainable score", () => {
    expect(decision.status).toBe("selected");
    expect(decision.selected!.observationId).toBe("fx-rappi-1");
    expect(decision.totalCents).toBe(1690);
    expect(decision.selected!.score!.formula).toBe("0.8×price 1 + 0.2×eta 0 = 0.8");
    expect(decision.alternatives.map((a) => a.observationId)).toEqual([
      "fx-99food-1",
      "fx-ifood-2",
      "fx-ifood-1",
      "fx-rappi-2"
    ]);
  });

  it("reports market median, savings, freshness and confidence", () => {
    expect(decision.marketMedianCents).toBe(2188);
    expect(decision.savings.vsMarketMedianCents).toBe(498);
    expect(decision.savings.vsMostExpensiveValidCents).toBe(799);
    expect(decision.freshness).toEqual({ selectedAgeMinutes: 25, newestAgeMinutes: 10, oldestAgeMinutes: 40 });
    expect(decision.confidence).toBe(0.48); // 0.95 normalization × 0.5 synthetic, rounded
    expect(decision.containsSynthetic).toBe(true);
  });

  it("marks other-account observations as market references, not executable offers", () => {
    expect(decision.selected!.executability).toMatchObject({ kind: "market-reference", executable: false });
    expect(decision.reasoning.join(" ")).toContain("may not be available to your account");
    expect(decision.bestExecutable).toBeNull();
  });

  it("speed preference changes the winner", () => {
    const fast = decide(intentOf("açaí 500ml até 25 reais urgente"), fixtures, { now: FIXTURE_NOW, policy: syntheticPolicy });
    expect(fast.selected!.observationId).toBe("fx-ifood-2");
  });

  it("reduces confidence for stale-but-allowed observations", () => {
    const lenient = decide(intent, fixtures, {
      now: FIXTURE_NOW,
      policy: { ...syntheticPolicy, rejectAfterMinutes: 7 * 24 * 60 }
    });
    const stale = [lenient.selected!, ...lenient.alternatives].find((c) => c.observationId === "fx-ifood-stale")!;
    expect(stale.accepted).toBe(true);
    expect(stale.warnings.join()).toContain("confidence reduced");
    expect(stale.confidence).toBeLessThan(0.95 * 0.5);
  });

  it("treats the user's current checkout as the only executable option", () => {
    const current: CartQuoteObservation = {
      ...(fixtures.find((f) => f.id === "fx-ifood-1") as CartQuoteObservation),
      id: "current",
      observerId: "me",
      provenance: { method: "browser-extension", live: true, synthetic: false }
    };
    const withCurrent = decide(intent, fixtures, {
      now: FIXTURE_NOW,
      policy: { ...syntheticPolicy, observerId: "me" },
      currentCheckout: current
    });
    expect(withCurrent.bestExecutable!.observationId).toBe("current");
    expect(withCurrent.savings.vsCurrentCheckoutCents).toBe(cents(2188 - 1690));
    expect(withCurrent.reasoning.join(" ")).toContain("Best option you can act on now");
  });
});
