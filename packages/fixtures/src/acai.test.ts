import { describe, expect, it } from "vitest";
import { validateProvenance, verifyCartQuote } from "@nape3/domain";
import { acaiFixtures } from "./acai";

describe("açaí fixtures", () => {
  const fixtures = acaiFixtures();

  it("covers iFood, Rappi and 99Food", () => {
    expect(new Set(fixtures.map((o) => o.source))).toEqual(new Set(["ifood", "rappi", "99food"]));
  });

  it("are all explicitly synthetic with valid provenance", () => {
    for (const observation of fixtures) {
      expect(observation.provenance).toMatchObject({ method: "fixture", synthetic: true, live: false });
      expect(validateProvenance(observation.provenance)).toEqual([]);
    }
  });

  it("have internally consistent cart totals", () => {
    for (const observation of fixtures) {
      if (observation.kind !== "cart-quote") continue;
      expect(verifyCartQuote(observation.quote).issues).toEqual([]);
    }
  });

  it("are deterministic", () => {
    expect(acaiFixtures()).toEqual(fixtures);
  });
});
