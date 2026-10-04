import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CartQuoteObservation } from "@nape3/domain";
import { acaiFixtures, FIXTURE_NOW } from "@nape3/fixtures";
import { createApp } from "./app";
import { MemoryStore } from "./store";

/** Fixture carts re-labelled as live extension captures, to exercise the real-only path. */
function asLive(observation: CartQuoteObservation, index: number): CartQuoteObservation {
  return {
    ...observation,
    id: `live-${index}`,
    observerId: `observer-${index}`,
    provenance: { method: "browser-extension", live: true, synthetic: false, collectorVersion: "test" }
  };
}

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer(createApp(new MemoryStore(), { now: () => FIXTURE_NOW, log: () => {}, rateLimitPerMinute: 1000 }));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const post = (path: string, body: unknown) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("observer API", () => {
  it("rejects synthetic observations", async () => {
    const response = await post("/v1/observations", acaiFixtures()[0]);
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("synthetic");
  });

  it("rejects invalid payloads with reasons", async () => {
    const response = await post("/v1/observations", { kind: "cart-quote", cookies: "x" });
    expect(response.status).toBe(422);
    expect((await response.json()).details.length).toBeGreaterThan(0);
  });

  it("ingests live observations idempotently and aggregates them", async () => {
    const carts = acaiFixtures().filter((o): o is CartQuoteObservation => o.kind === "cart-quote");
    for (const [index, cart] of carts.entries()) {
      const response = await post("/v1/observations", asLive(cart, index));
      expect(response.status).toBe(201);
    }
    expect((await post("/v1/observations", asLive(carts[0]!, 0))).status).toBe(200);

    const summary = await (await fetch(`${base}/v1/market/summary?category=acai&volumeMl=500&region=BR-SP-sao-paulo`)).json();
    expect(summary).toMatchObject({ sampleSize: 6, medianCents: 2188, lowestCents: 1690, containsSynthetic: false });
    expect(JSON.stringify(summary)).not.toContain("observer-");
  });

  it("compares a checkout in observational language", async () => {
    const response = await post("/v1/market/compare", { totalCents: 2490, category: "acai", volumeMl: 500, region: "BR-SP-sao-paulo" });
    const body = await response.json();
    expect(body.comparison.message).toMatch(/^Your checkout is R\$24,90\. Comparable observations range from R\$16,90 to R\$31,88/);
  });

  it("validates query parameters", async () => {
    expect((await fetch(`${base}/v1/market/summary?category=churrasco`)).status).toBe(400);
    expect((await fetch(`${base}/v1/market/summary?category=pizza&size=enorme`)).status).toBe(400);
    expect((await fetch(`${base}/v1/market/summary?category=pizza&size=grande`)).status).toBe(200);
    expect((await post("/v1/market/compare", { totalCents: 24.9, category: "acai" })).status).toBe(400);
  });
});
