import { describe, expect, it } from "vitest";
import { cents } from "@nape3/domain";
import { acaiFixtures, FIXTURE_NOW } from "@nape3/fixtures";
import { compareCheckout, summarizeMarket, type MarketQuery } from "./summary";

const fixtures = acaiFixtures();
const base: MarketQuery = {
  requirement: { category: "acai", volumeMl: 500 },
  quantity: 1,
  now: FIXTURE_NOW,
  provenance: "include-synthetic"
};

describe("summarizeMarket", () => {
  it("excludes synthetic data by default", () => {
    const summary = summarizeMarket(fixtures, { ...base, provenance: undefined });
    expect(summary.sampleSize).toBe(0);
    expect(summary.sufficient).toBe(false);
    expect(summary.excluded.every((e) => e.reason.startsWith("provenance policy"))).toBe(true);
  });

  it("aggregates fresh comparable cart totals and flags synthetic data", () => {
    const summary = summarizeMarket(fixtures, base);
    expect(summary.sampleSize).toBe(7);
    expect(summary.lowestCents).toBe(1690);
    expect(summary.highestCents).toBe(3188);
    expect(summary.medianCents).toBe(2188);
    expect(summary.spreadCents).toBe(1498);
    expect(summary.freshness).toEqual({ freshWithinMinutes: 60, newestAgeMinutes: 8, oldestAgeMinutes: 40 });
    expect(summary.containsSynthetic).toBe(true);
    expect(summary.provenanceMix.synthetic).toBe(7);
  });

  it("explains every exclusion", () => {
    const reasons = Object.fromEntries(summarizeMarket(fixtures, base).excluded.map((e) => [e.id, e.reason]));
    expect(reasons["fx-ifood-stale"]).toMatch(/^stale/);
    expect(reasons["fx-ifood-300"]).toContain("300 ml");
    expect(reasons["fx-rappi-extra"]).toContain("Água");
    expect(reasons["fx-99food-item"]).toContain("item-only");
  });

  it("restricts headline stats to a region but reports regional variation", () => {
    const summary = summarizeMarket(fixtures, { ...base, marketRegion: "BR-SP-sao-paulo" });
    expect(summary.sampleSize).toBe(6);
    expect(summary.regionalVariation.map((g) => [g.key, g.sampleSize])).toEqual([
      ["BR-RJ-rio-de-janeiro", 1],
      ["BR-SP-sao-paulo", 6]
    ]);
    const club = summary.accountContextVariation.find((g) => g.key === "membership:ifood-club");
    expect(club).toMatchObject({ sampleSize: 1, medianCents: 2188 });
  });

  it("can exclude the user's own observation", () => {
    expect(summarizeMarket(fixtures, { ...base, excludeIds: ["fx-ifood-1"] }).sampleSize).toBe(6);
  });

  it("widening the freshness window includes stale observations", () => {
    expect(summarizeMarket(fixtures, { ...base, freshWithinMinutes: 7 * 24 * 60 }).sampleSize).toBe(8);
  });
});

describe("compareCheckout", () => {
  const summary = summarizeMarket(fixtures, base);

  it("uses observational language", () => {
    const result = compareCheckout(cents(2490), summary);
    expect(result.position).toBe("above-median");
    expect(result.differenceFromMedianCents).toBe(302);
    expect(result.message).toBe(
      "Your checkout is R$24,90. Comparable observations range from R$16,90 to R$31,88 (median R$21,88, 7 fresh observations). That is R$3,02 above the observed median. Includes synthetic fixture data."
    );
    expect(result.message).not.toMatch(/discriminat|unfair|overcharg/i);
  });

  it("classifies position", () => {
    expect(compareCheckout(cents(1500), summary).position).toBe("below-observed-range");
    expect(compareCheckout(cents(2000), summary).position).toBe("at-or-below-median");
    expect(compareCheckout(cents(4000), summary).position).toBe("above-observed-range");
  });

  it("refuses to compare without enough data", () => {
    const thin = summarizeMarket(fixtures.slice(0, 2), base);
    const result = compareCheckout(cents(2490), thin);
    expect(result.position).toBe("insufficient-data");
    expect(result.message).toContain("Not enough fresh market data");
  });
});
