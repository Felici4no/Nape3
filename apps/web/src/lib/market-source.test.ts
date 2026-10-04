import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CartQuoteObservation, MarketObservation } from "@nape3/domain";
import { cartObservation, marketFixtures, type CartSpec } from "@nape3/fixtures";
import { createApp } from "../../../observer-api/src/app";
import { MemoryStore } from "../../../observer-api/src/store";
import { INSTRUMENTS, planIntent, quoteAll, quoteInstrument } from "./market";
import { acceptLive, describeSource, loadMarketSource, resolveMode, type MarketSource } from "./source";

/**
 * The real pipeline: extension-shaped observations → observer API → web
 * market source → quotes → agent decision. Plus the scenarios that make a
 * live market hard: stale data, mixed platforms, quantities, regions and
 * account-specific prices, and the never-mix rule.
 */

const NOW = new Date("2026-10-04T12:00:00.000Z");
const ACAI_500 = INSTRUMENTS.find((i) => i.slug === "acai-500ml")!;

/** What the extension uploads: a real, live browser capture. */
function live(spec: Partial<CartSpec> & { id: string; unit: number; minutesAgo: number }): CartQuoteObservation {
  const observation = cartObservation(
    {
      source: "ifood",
      merchant: `Loja ${spec.id}`,
      lines: [{ title: "Açaí 500ml", unit: spec.unit }],
      delivery: 0,
      service: 0,
      ...spec
    } as CartSpec,
    NOW
  );
  return {
    ...observation,
    observerId: `install-${spec.id}`,
    provenance: { method: "browser-extension", live: true, synthetic: false, collectorVersion: "test", rawReference: "ifood:checkout" }
  };
}

function liveSource(observations: MarketObservation[]): MarketSource {
  return {
    mode: "live",
    reason: "observer-configured",
    switchAllowed: false,
    status: observations.length ? "ok" : "empty",
    observations,
    origin: "observer-api",
    fetchedAt: NOW.toISOString(),
    windowMinutes: 7 * 24 * 60,
    dropped: 0,
    error: null
  };
}

const fresh = [
  live({ id: "a", unit: 2000, minutesAgo: 5, source: "ifood" }),
  live({ id: "b", unit: 2200, minutesAgo: 30, source: "rappi" }),
  live({ id: "c", unit: 2400, minutesAgo: 60, source: "99food" })
];

describe("mode resolution", () => {
  it("prefers live whenever an observer API is configured", () => {
    expect(resolveMode({ OBSERVER_API_URL: "http://127.0.0.1:8787" }, undefined).mode).toBe("live");
  });
  it("falls back to the labelled demo only when no observer is configured", () => {
    expect(resolveMode({}, undefined)).toMatchObject({ mode: "demo", reason: "no-observer-configured" });
  });
  it("honours the development switch outside production only", () => {
    const env = { OBSERVER_API_URL: "http://x", NODE_ENV: "development" };
    expect(resolveMode(env, "demo")).toMatchObject({ mode: "demo", reason: "dev-switch" });
    expect(resolveMode({ ...env, NODE_ENV: "production" }, "demo").mode).toBe("live");
    expect(resolveMode({ ...env, NODE_ENV: "production", ALLOW_DEMO_TOGGLE: "1" }, "demo").mode).toBe("demo");
  });
});

describe("never mixing synthetic and live", () => {
  it("drops synthetic or invalid items that reach the live path", () => {
    const { observations, dropped } = acceptLive([fresh[0], marketFixtures(NOW)[0], { kind: "cart-quote", cookies: "x" }]);
    expect(observations.map((o) => o.id)).toEqual(["a"]);
    expect(dropped).toBe(2);
  });

  it("live quotes ignore synthetic observations even if handed a mixed list", () => {
    const mixed = [...fresh, ...marketFixtures(NOW)];
    const quote = quoteInstrument(mixed, ACAI_500, NOW, "live");
    expect(quote.summary.containsSynthetic).toBe(false);
    expect(quote.observations.every((o) => !o.synthetic)).toBe(true);
    expect(quote.summary.sampleSize).toBe(3);
  });

  it("demo quotes ignore real observations", () => {
    const quote = quoteInstrument([...fresh, ...marketFixtures(NOW)], ACAI_500, NOW, "demo");
    expect(quote.observations.every((o) => o.synthetic)).toBe(true);
    expect(quote.observations.some((o) => ["a", "b", "c"].includes(o.id))).toBe(false);
  });

  it("an unreachable live market is empty, never the fixtures", async () => {
    const source = await loadMarketSource({
      env: { OBSERVER_API_URL: "http://127.0.0.1:1" },
      now: NOW,
      fetchImpl: () => Promise.reject(new TypeError("fetch failed"))
    });
    expect(source).toMatchObject({ mode: "live", status: "unavailable", observations: [], origin: "observer-api" });
    expect(describeSource(source).synthetic).toBe(false);
  });

  it("the agent over a live source never selects synthetic data", () => {
    const plan = planIntent(liveSource([...fresh, ...marketFixtures(NOW)]), "quero um açaí 500ml até R$30", NOW);
    expect(plan.decision?.selected?.observationId).toBe("a");
    expect(plan.decision?.containsSynthetic).toBe(false);
  });
});

describe("live market scenarios", () => {
  it("stale observations are not quoted but are reported for the empty state", () => {
    const stale = [
      live({ id: "s1", unit: 1500, minutesAgo: 180 }),
      live({ id: "s2", unit: 1600, minutesAgo: 600 }),
      live({ id: "s3", unit: 1700, minutesAgo: 3000 })
    ];
    const quote = quoteInstrument(stale, ACAI_500, NOW, "live");
    expect(quote.summary.sufficient).toBe(false);
    expect(quote.summary.sampleSize).toBe(0);
    expect(quote.stale).toEqual({ count: 3, newestAgeMinutes: 180 });
    const plan = planIntent(liveSource(stale), "quero um açaí 500ml", NOW);
    expect(plan.decision?.selected).toBeFalsy();
  });

  it("mixed platforms are compared on checkout total", () => {
    const quote = quoteInstrument(fresh, ACAI_500, NOW, "live");
    expect(new Set(quote.observations.map((o) => o.source))).toEqual(new Set(["ifood", "rappi", "99food"]));
    expect(quote.summary).toMatchObject({ sufficient: true, lowestCents: 2000, medianCents: 2200, highestCents: 2400 });
  });

  it("carts with a different quantity or size stay out of the single-unit market", () => {
    const observations = [
      ...fresh,
      live({ id: "two", unit: 1500, minutesAgo: 5, lines: [{ title: "Açaí 500ml", unit: 1500, quantity: 2 }] }),
      live({ id: "small", unit: 900, minutesAgo: 5, lines: [{ title: "Açaí 300ml", unit: 900 }] })
    ];
    const quote = quoteInstrument(observations, ACAI_500, NOW, "live");
    expect(quote.observations.map((o) => o.id).sort()).toEqual(["a", "b", "c"]);
    expect(quote.summary.lowestCents).toBe(2000);
    const small = quoteInstrument(observations, INSTRUMENTS.find((i) => i.slug === "acai-300ml")!, NOW, "live");
    expect(small.observations.map((o) => o.id)).toEqual(["small"]);
  });

  it("other regions are kept out of the headline and reported as variation", () => {
    const observations = [...fresh, live({ id: "rj", unit: 1200, minutesAgo: 5, region: "BR-RJ-rio-de-janeiro" })];
    const quote = quoteInstrument(observations, ACAI_500, NOW, "live");
    expect(quote.summary.lowestCents).toBe(2000);
    expect(quote.otherRegions).toBe(1);
    expect(quote.summary.regionalVariation.map((g) => g.key)).toEqual(["BR-RJ-rio-de-janeiro", "BR-SP-sao-paulo"]);
  });

  it("account-specific prices are flagged and never executable for the current account", () => {
    const observations = [
      ...fresh,
      live({ id: "club", unit: 1400, minutesAgo: 5, membership: "ifood-club", promotionScope: "account-specific" })
    ];
    const quote = quoteInstrument(observations, ACAI_500, NOW, "live");
    expect(quote.lowestIsAccountSpecific).toBe(true);
    expect(quote.observations[0]).toMatchObject({ id: "club", accountSpecific: true, promotion: "account-specific" });
    expect(quote.summary.accountContextVariation.map((g) => g.key)).toContain("promotion:account-specific");

    const plan = planIntent(liveSource(observations), "quero um açaí 500ml até R$30", NOW);
    expect(plan.decision?.selected?.observationId).toBe("club");
    expect(plan.decision?.selected?.executability).toMatchObject({ kind: "market-reference", executable: false });
  });
});

describe("pipeline: extension → observer API → live market → agent decision", () => {
  let server: Server;
  let url: string;
  const TOKEN = "read-token-for-tests";

  beforeAll(async () => {
    server = createServer(createApp(new MemoryStore(), { readToken: TOKEN, now: () => NOW, log: () => {}, rateLimitPerMinute: 1000 }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const uploads = [...fresh, live({ id: "rj", unit: 1200, minutesAgo: 5, region: "BR-RJ-rio-de-janeiro" })];
    for (const observation of uploads) {
      const response = await fetch(`${url}/v1/observations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(observation) });
      expect(response.status).toBe(201);
    }
    // The network refuses synthetic data at the door.
    const synthetic = await fetch(`${url}/v1/observations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(marketFixtures(NOW)[0]) });
    expect(synthetic.status).toBe(422);
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("without the read token the live market is unavailable, not demo", async () => {
    const source = await loadMarketSource({ env: { OBSERVER_API_URL: url }, now: NOW });
    expect(source).toMatchObject({ mode: "live", status: "unavailable", error: "observer API answered 401", observations: [] });
  });

  it("reads real observations, quotes the market and decides over it", async () => {
    const source = await loadMarketSource({ env: { OBSERVER_API_URL: url, OBSERVER_READ_TOKEN: TOKEN }, now: NOW });
    expect(source).toMatchObject({ mode: "live", status: "ok", origin: "observer-api", dropped: 0 });
    expect(source.observations).toHaveLength(4);
    expect(source.observations.every((o) => o.observerId === undefined && o.provenance.live && !o.provenance.synthetic)).toBe(true);

    const acai = quoteAll(source, NOW).find((q) => q.instrument.slug === "acai-500ml")!;
    expect(acai.summary).toMatchObject({ sufficient: true, sampleSize: 3, lowestCents: 2000, containsSynthetic: false });
    expect(acai.otherRegions).toBe(1);
    const pizza = quoteAll(source, NOW).find((q) => q.instrument.slug === "pizza-grande")!;
    expect(pizza.summary.sampleSize).toBe(0);

    const plan = planIntent(source, "quero um açaí 500ml até R$25", NOW);
    expect(plan.decision?.status).toBe("selected");
    expect(plan.decision?.selected).toMatchObject({ observationId: "a", source: "ifood" });
    expect(plan.decision?.selected?.executability.executable).toBe(false);
    expect(plan.agent.state).toBe("USER_CONFIRMATION");
  });
});
