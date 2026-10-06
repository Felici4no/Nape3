// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { addSnapshot, createSession, forbiddenContent, latestSnapshot, memoryStore, validateSnapshot } from "../../web/src/lib/dev-bridge";
import { bridgeKey, buildBridgePayload } from "../src/content/devbridge";
import { takeSnapshot } from "../src/content/extract";

const SEARCH_URL = "https://www.ifood.com.br/busca?q=acai&tab=itens";

function searchPageWithPii() {
  const html = readFileSync(join(__dirname, "fixtures", "search.html"), "utf8").replace(
    "<body>",
    `<body><header><span>Entregar em</span><span>Rua Augusta, 1500 - Apto 12</span><span>Olá, Maria</span></header>
     <div role="dialog"><p>Seu e-mail maria@example.com · (11) 98765-4321 · CEP 01310-100</p><input value="00020126580014br.gov.bcb.pix0136abc"/></div>`
  );
  return new JSDOM(html, { url: SEARCH_URL }).window.document;
}

describe("dev bridge payload (extension) → server checks", () => {
  it("is a valid v1 snapshot that the server stores, with no personal data left", async () => {
    const doc = searchPageWithPii();
    const payload = buildBridgePayload(doc, takeSnapshot(doc, SEARCH_URL), "0.2.0");
    const raw = JSON.stringify(payload);
    expect(validateSnapshot(payload).ok).toBe(true);
    expect(forbiddenContent(raw)).toBeNull();
    for (const secret of ["Augusta", "maria@example.com", "98765-4321", "01310-100", "br.gov.bcb.pix0136abc"]) expect(raw).not.toContain(secret);
    expect(payload.context).toBe("SEARCH_RESULTS");
    expect(payload.diagnostics.path).toBe("/busca");

    const store = memoryStore();
    const { sessionId } = await createSession(store, Date.now());
    expect(await addSnapshot(store, sessionId, raw, Date.now())).toMatchObject({ ok: true });
    expect(await latestSnapshot(store, sessionId, Date.now())).toMatchObject({ found: true, snapshot: { context: "SEARCH_RESULTS" } });
  });

  it("dedupes: the same route, context and page size is the same state", () => {
    const doc = searchPageWithPii();
    const snapshot = takeSnapshot(doc, SEARCH_URL);
    expect(bridgeKey(doc, snapshot)).toBe(bridgeKey(doc, snapshot));
    doc.body.insertAdjacentHTML("beforeend", `<div>${"x".repeat(2000)}</div>`);
    expect(bridgeKey(doc, snapshot)).not.toBe(bridgeKey(searchPageWithPii(), snapshot));
  });
});
