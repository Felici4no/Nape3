import { afterEach, describe, expect, it, vi } from "vitest";
import { pingExtension, setExtensionId } from "./bridge";

const ID = "nmdallmhcliifgnlclnamonkmgepecok";
const g = globalThis as unknown as { chrome?: unknown; localStorage?: Storage; location?: unknown };

function storage(): Storage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k), clear: () => map.clear(), key: () => null, length: 0 };
}

afterEach(() => {
  delete g.chrome;
  delete g.localStorage;
  delete g.location;
  vi.useRealTimers();
});

function setup(sendMessage?: (id: string, message: unknown, cb: (r: unknown) => void) => void, lastError?: string) {
  g.localStorage = storage();
  g.location = { hash: "" };
  setExtensionId(ID);
  if (sendMessage) g.chrome = { runtime: { sendMessage, ...(lastError ? { lastError: { message: lastError } } : {}) } };
}

describe("pingExtension names the transport link that failed", () => {
  it("without an id: NO_EXTENSION_ID", async () => {
    g.localStorage = storage();
    g.location = { hash: "" };
    expect((await pingExtension()).failure).toBe("NO_EXTENSION_ID");
  });

  it("chrome.runtime missing on the page (site not in externally_connectable): CHROME_RUNTIME_UNAVAILABLE", async () => {
    setup();
    expect((await pingExtension()).failure).toBe("CHROME_RUNTIME_UNAVAILABLE");
  });

  it("wrong id / disabled extension: EXTENSION_NOT_FOUND with Chrome's reason", async () => {
    setup((_id, _m, cb) => cb(undefined), "Could not establish connection. Receiving end does not exist.");
    expect(await pingExtension()).toMatchObject({ reachable: false, failure: "EXTENSION_NOT_FOUND", detail: expect.stringContaining("Receiving end") });
  });

  it("the extension refuses this origin: ORIGIN_REJECTED", async () => {
    setup((_id, _m, cb) => cb({ ok: false, error: "origin not allowed" }));
    expect((await pingExtension()).failure).toBe("ORIGIN_REJECTED");
  });

  it("no answer: TIMEOUT", async () => {
    vi.useFakeTimers();
    setup(() => undefined);
    const pending = pingExtension(1_000);
    await vi.advanceTimersByTimeAsync(1_001);
    expect((await pending).failure).toBe("TIMEOUT");
  });

  it("answered: reachable, with the report; the message is only PING", async () => {
    const sent: unknown[] = [];
    setup((id, m, cb) => {
      expect(id).toBe(ID);
      sent.push(m);
      cb({ ok: true, report: { background: "connected", ifoodContentScript: { status: "connected", context: "SEARCH_RESULTS" } } });
    });
    const ping = await pingExtension();
    expect(ping).toMatchObject({ reachable: true, failure: null, report: { background: "connected" } });
    expect(sent).toEqual([{ type: "PING" }]);
  });
});
