import { describe, expect, it } from "vitest";
import type { CartQuoteObservation } from "@nape3/domain";
import { acaiFixtures, FIXTURE_NOW } from "@nape3/fixtures";
import { mergeNetworkObservations } from "./network";

const real = (o: CartQuoteObservation, id: string): CartQuoteObservation => ({
  ...o,
  id,
  provenance: { method: "browser-extension", live: true, synthetic: false }
});

describe("mergeNetworkObservations", () => {
  const carts = acaiFixtures(FIXTURE_NOW).filter((o): o is CartQuoteObservation => o.kind === "cart-quote");

  it("adds remote real observations and keeps own ones on id collisions", () => {
    const own = [real(carts[0]!, "own-1")];
    const remote = [{ ...own[0], observerId: undefined }, real(carts[1]!, "net-1")];
    const { observations, dropped } = mergeNetworkObservations(own, remote);
    expect(observations.map((o) => o.id)).toEqual(["own-1", "net-1"]);
    expect(observations[0]).toBe(own[0]);
    expect(dropped).toBe(0);
  });

  it("drops synthetic and malformed items from the network", () => {
    const { observations, dropped } = mergeNetworkObservations([], [carts[0], { kind: "cart-quote", cookies: "x" }, "nope"]);
    expect(observations).toEqual([]);
    expect(dropped).toBe(3);
  });

  it("tolerates a non-array payload", () => {
    expect(mergeNetworkObservations([], { error: "x" })).toEqual({ observations: [], dropped: 0 });
  });
});
