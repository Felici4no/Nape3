import { describe, expect, it } from "vitest";
import { addSnapshot, authorized, bridgeEnabled, createSession, forbiddenContent, latestSnapshot, listSnapshots, memoryStore, SCHEMA, TTL_MS } from "./dev-bridge";

const TOKEN = "dev-bridge-test-token-0123456789abcdef";
const T0 = Date.parse("2026-10-06T12:00:00Z");

function snapshot(patch: Record<string, unknown> = {}) {
  return JSON.stringify({
    schema: SCHEMA,
    capturedAt: new Date(T0).toISOString(),
    context: "SEARCH_RESULTS",
    detection: { context: "SEARCH_RESULTS", confidence: 0.75, signals: ["url /\\/busca/"] },
    extracted: {},
    sanitizedStructure: '<main>\n  "Açaí do Bairro"\n  "R$ 18,90"\n</main>',
    diagnostics: { extensionVersion: "0.2.0", pageContext: "SEARCH_RESULTS", navigationType: "navigate", pageAgeSeconds: 4, path: "/busca" },
    ...patch
  });
}

describe("dev bridge: enabled only with both tokens, writes only with the bridge token", () => {
  it("is off without DEV_BRIDGE_TOKEN (or a short one) or without the Blob token", () => {
    expect(bridgeEnabled({})).toBe(false);
    expect(bridgeEnabled({ DEV_BRIDGE_TOKEN: TOKEN })).toBe(false);
    expect(bridgeEnabled({ DEV_BRIDGE_TOKEN: "short", BLOB_READ_WRITE_TOKEN: "x" })).toBe(false);
    expect(bridgeEnabled({ DEV_BRIDGE_TOKEN: TOKEN, BLOB_READ_WRITE_TOKEN: "x" })).toBe(true);
  });

  it("authorizes only the exact bearer token", () => {
    const req = (h?: string) => new Request("https://upay3food.com/api/dev/extension/session", { method: "POST", headers: h ? { authorization: h } : {} });
    expect(authorized(req(`Bearer ${TOKEN}`), { DEV_BRIDGE_TOKEN: TOKEN })).toBe(true);
    expect(authorized(req(`Bearer ${TOKEN}x`), { DEV_BRIDGE_TOKEN: TOKEN })).toBe(false);
    expect(authorized(req(), { DEV_BRIDGE_TOKEN: TOKEN })).toBe(false);
    expect(authorized(req(`Bearer ${TOKEN}`), {})).toBe(false);
  });
});

describe("dev bridge sessions", () => {
  it("stores a sanitized snapshot and returns the latest one by random session id", async () => {
    let now = T0;
    const store = memoryStore(() => now);
    const { sessionId } = await createSession(store, now);
    expect(sessionId).toMatch(/^[0-9a-f]{32}$/);
    expect((await addSnapshot(store, sessionId, snapshot(), now)).ok).toBe(true);
    now += 5_000;
    expect((await addSnapshot(store, sessionId, snapshot({ context: "RESTAURANT" }), now)).ok).toBe(true);
    const latest = await latestSnapshot(store, sessionId, now);
    expect(latest).toMatchObject({ found: true, count: 2, snapshot: { context: "RESTAURANT", receivedAt: expect.any(String) } });
    expect(await listSnapshots(store, sessionId, now)).toHaveLength(2);
  });

  it("refuses unknown sessions, malformed ids, bad schemas and oversized bodies", async () => {
    const store = memoryStore(() => T0);
    const { sessionId } = await createSession(store, T0);
    expect(await addSnapshot(store, "0".repeat(32), snapshot(), T0)).toMatchObject({ ok: false, status: 410 });
    expect(await addSnapshot(store, "../etc", snapshot(), T0)).toMatchObject({ ok: false, status: 400 });
    expect(await addSnapshot(store, sessionId, snapshot({ schema: "other" }), T0)).toMatchObject({ ok: false, status: 400 });
    expect(await addSnapshot(store, sessionId, "x".repeat(600_000), T0)).toMatchObject({ ok: false, status: 413 });
  });

  it("TTL: after 30 minutes the session and its snapshots are deleted on the next read or write", async () => {
    let now = T0;
    const store = memoryStore(() => now);
    const { sessionId } = await createSession(store, now);
    await addSnapshot(store, sessionId, snapshot(), now);
    now += TTL_MS + 1;
    expect(await latestSnapshot(store, sessionId, now)).toEqual({ found: false });
    expect(store.size()).toBe(0);
    expect(await addSnapshot(store, sessionId, snapshot(), now)).toMatchObject({ ok: false, status: 410 });
  });
});

describe("dev bridge never stores personal data (second check after the extension's scrub)", () => {
  const leaks: Array<[string, string]> = [
    ["email", "contato maria@example.com"],
    ["cpf", "CPF 123.456.789-09"],
    ["cep", "CEP 01310-100"],
    ["phone", "(11) 98765-4321"],
    ["pix-payload", "00020126580014br.gov.bcb.pix0136abc"],
    ["street-address", "Rua Augusta, 1500"],
    ["auth-material", "set-cookie: session=abc"]
  ];

  for (const [rule, text] of leaks) {
    it(`refuses a snapshot carrying ${rule}, without storing anything`, async () => {
      const store = memoryStore(() => T0);
      const { sessionId } = await createSession(store, T0);
      const before = store.size();
      const result = await addSnapshot(store, sessionId, snapshot({ sanitizedStructure: `<main>"${text}"</main>` }), T0);
      expect(result).toMatchObject({ ok: false, status: 422 });
      expect(JSON.stringify(result)).not.toContain(text);
      expect(store.size()).toBe(before);
      expect(forbiddenContent(text)).toBe(rule);
    });
  }

  it("prices, ETAs, ratings and scrub markers are fine", () => {
    expect(forbiddenContent('"R$ 18,90" "30-40 min" "4,7" "[address]" "[phone]" "[text 18 chars]" "Açaí 500ml"')).toBeNull();
  });
});
