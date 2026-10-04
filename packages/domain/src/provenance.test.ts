import { describe, expect, it } from "vitest";
import { ageMinutes, provenanceClass, validateProvenance } from "./provenance";

describe("provenance invariants", () => {
  it("accepts coherent provenance", () => {
    expect(validateProvenance({ method: "fixture", live: false, synthetic: true })).toEqual([]);
    expect(validateProvenance({ method: "browser-extension", live: true, synthetic: false })).toEqual([]);
    expect(validateProvenance({ method: "manual", live: false, synthetic: false })).toEqual([]);
  });

  it("rejects mixed or contradictory flags", () => {
    expect(validateProvenance({ method: "fixture", live: false, synthetic: false })).toContain(
      "fixture data must be marked synthetic"
    );
    expect(validateProvenance({ method: "browser-extension", live: true, synthetic: true }).length).toBeGreaterThan(0);
    expect(validateProvenance({ method: "manual", live: true, synthetic: false })).toContain(
      "manually entered observations are not live"
    );
  });

  it("classifies", () => {
    expect(provenanceClass({ method: "fixture", live: false, synthetic: true })).toBe("synthetic");
    expect(provenanceClass({ method: "manual", live: false, synthetic: false })).toBe("manual");
    expect(provenanceClass({ method: "browser-extension", live: true, synthetic: false })).toBe("live");
  });

  it("computes age, treating invalid dates as infinitely old", () => {
    const now = new Date("2026-10-04T12:00:00Z");
    expect(ageMinutes("2026-10-04T11:30:00Z", now)).toBe(30);
    expect(ageMinutes("not a date", now)).toBe(Number.POSITIVE_INFINITY);
  });
});
