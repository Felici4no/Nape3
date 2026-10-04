import { describe, expect, it } from "vitest";
import { FIXTURE_NOW, marketFixtures } from "@nape3/fixtures";
import { priceChange } from "./change";
import { summarizeMarket, type MarketQuery } from "./summary";

const obs = marketFixtures();
const q = (requirement: MarketQuery["requirement"]): MarketQuery => ({
  requirement,
  quantity: 1,
  now: FIXTURE_NOW,
  freshWithinMinutes: 120,
  provenance: "include-synthetic",
  marketRegion: "BR-SP-sao-paulo"
});

describe("market fixtures (all categories)", () => {
  it("summarize each instrument from fresh comparable carts only", () => {
    expect(summarizeMarket(obs, q({ category: "burger" }))).toMatchObject({ sampleSize: 5, lowestCents: 2189, containsSynthetic: true });
    expect(summarizeMarket(obs, q({ category: "pizza", size: "grande" })).sampleSize).toBe(4);
    expect(summarizeMarket(obs, q({ category: "sushi", pieces: 20 })).sampleSize).toBe(3);
  });
});

describe("priceChange", () => {
  it("reports movement only when both windows have enough data", () => {
    const burger = priceChange(obs, q({ category: "burger" }));
    expect(burger).not.toBeNull();
    expect(burger!.changeCents).toBeLessThan(0);
    expect(burger!.previousSampleSize).toBe(4);

    const pizza = priceChange(obs, q({ category: "pizza", size: "grande" }));
    expect(pizza!.changeCents).toBeGreaterThan(0);

    // Sushi has a single observation a day ago: no movement is reported.
    expect(priceChange(obs, q({ category: "sushi", pieces: 20 }))).toBeNull();
  });

  it("never lets newer observations leak into the previous window", () => {
    const acai = priceChange(obs, q({ category: "acai", volumeMl: 500 }));
    expect(acai!.previousSampleSize).toBe(4);
    expect(acai!.changeBps).toBe(Math.round((acai!.changeCents * 10_000) / acai!.previousMedianCents));
  });
});
