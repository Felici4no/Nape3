import { afterEach, describe, expect, it, vi } from "vitest";
import { ALLOWED_METHODS, handleSolanaRpc, MAINNET_GENESIS_HASH, MAX_BATCH, MAX_BODY_BYTES, proxyHealth, scrub, type ProxyEnv } from "./solana-rpc-proxy";

// Synthetic: same shape as a real key, never a real one.
const KEY = "TESTKEY0aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5bC7dE9fG1hJ3kL5mN7pQ9rS";
const UPSTREAM = `https://solana-rpc.rpcfast.com/?api_key=${KEY}`;
const ENV: ProxyEnv = { RPC_FAST_URL: UPSTREAM, NODE_ENV: "production" };
const SITE = "https://upay3food.com";

function call(body: unknown, init: { origin?: string | null; headers?: Record<string, string>; url?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init.headers ?? {}) };
  if (init.origin !== null) headers.origin = init.origin ?? SITE;
  return new Request(init.url ?? `${SITE}/api/solana-rpc`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
}

function upstreamReturning(body: string, status = 200, headers: Record<string, string> = {}) {
  return vi.fn(async (_url: string, _init: RequestInit) => new Response(body, { status, headers }));
}

const ok = (id: unknown, result: unknown) => JSON.stringify({ jsonrpc: "2.0", id, result });

afterEach(() => vi.restoreAllMocks());

describe("forwarding", () => {
  it("forwards the body verbatim to the configured endpoint and returns the upstream response", async () => {
    const body = { jsonrpc: "2.0", id: 7, method: "getBalance", params: ["9qAezschd4e5t5yi9F5SAw41g43Vuj6iYMh7dpcKqkUi", { commitment: "confirmed" }] };
    const upstream = upstreamReturning(ok(7, { context: { slot: 1 }, value: 12895810 }));
    const response = await handleSolanaRpc(call(body), ENV, upstream);

    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0]!;
    expect(url).toBe(new URL(UPSTREAM).toString());
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(body));
    expect(init.redirect).toBe("error");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jsonrpc: "2.0", id: 7, result: { context: { slot: 1 }, value: 12895810 } });
  });

  it("preserves numeric precision and string ids by passing the text through untouched", async () => {
    const raw = '{"jsonrpc":"2.0","id":"abc-1","result":{"lamports":18446744073709551615}}';
    const response = await handleSolanaRpc(call({ jsonrpc: "2.0", id: "abc-1", method: "getSlot" }), ENV, upstreamReturning(raw));
    expect(await response.text()).toBe(raw);
  });

  it("supports a batch and forwards it as one request", async () => {
    const batch = [
      { jsonrpc: "2.0", id: 1, method: "getSlot" },
      { jsonrpc: "2.0", id: 2, method: "getBlockHeight" }
    ];
    const upstream = upstreamReturning(JSON.stringify([{ jsonrpc: "2.0", id: 1, result: 5 }, { jsonrpc: "2.0", id: 2, result: 4 }]));
    const response = await handleSolanaRpc(call(batch), ENV, upstream);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls[0]![1].body).toBe(JSON.stringify(batch));
    expect((await response.json()).map((r: { id: number }) => r.id)).toEqual([1, 2]);
  });

  it("sends the key as a header when configured that way", async () => {
    const upstream = upstreamReturning(ok(1, "ok"));
    const env: ProxyEnv = { RPC_FAST_URL: "https://solana-rpc.rpcfast.com/", RPC_FAST_API_KEY: "header-key-123456", NODE_ENV: "production" };
    await handleSolanaRpc(call({ jsonrpc: "2.0", id: 1, method: "getHealth" }), env, upstream);
    expect((upstream.mock.calls[0]![1].headers as Record<string, string>)["x-api-key"]).toBe("header-key-123456");
  });

  it("every method the Cloak SDK and the balance checks use is allowed", () => {
    for (const m of [
      "getAccountInfo", "getMultipleAccounts", "getBalance", "getBlockHeight", "getLatestBlockhash", "getMinimumBalanceForRentExemption",
      "getSignaturesForAddress", "getSignatureStatuses", "getSlot", "getTokenAccountBalance", "getTransaction", "sendTransaction",
      "simulateTransaction", "getTokenAccountsByOwner"
    ]) {
      expect(ALLOWED_METHODS.has(m), m).toBe(true);
    }
  });
});

describe("the upstream cannot be chosen by the caller", () => {
  it("ignores url-like fields, query strings and headers: the configured endpoint is always used", async () => {
    const upstream = upstreamReturning(ok(1, 5));
    await handleSolanaRpc(
      call({ jsonrpc: "2.0", id: 1, method: "getSlot", url: "https://evil.example", endpoint: "https://evil.example" }, {
        url: `${SITE}/api/solana-rpc?url=https://evil.example&target=https://evil.example`,
        headers: { "x-upstream": "https://evil.example", "x-forwarded-host": "evil.example", host: "evil.example" },
        origin: SITE
      }),
      { ...ENV, RPC_PROXY_ALLOWED_ORIGINS: SITE },
      upstream
    );
    // origin differs from the forwarded host here, but the allowlist covers it; the target must still be fixed
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(upstream.mock.calls[0]![0]).toBe(new URL(UPSTREAM).toString());
  });

  it("refuses methods outside the allowlist without calling upstream, keeping the id", async () => {
    for (const method of ["requestAirdrop", "getProgramAccounts", "getBlock", "setIdentity", "__proto__"]) {
      const upstream = upstreamReturning(ok(9, 1));
      const response = await handleSolanaRpc(call({ jsonrpc: "2.0", id: 9, method, params: [] }), ENV, upstream);
      expect(response.status, method).toBe(403);
      expect((await response.json()).id).toBe(9);
      expect(upstream).not.toHaveBeenCalled();
    }
  });

  it("refuses a batch if any entry is not allowed", async () => {
    const upstream = upstreamReturning("[]");
    const response = await handleSolanaRpc(
      call([{ jsonrpc: "2.0", id: 1, method: "getSlot" }, { jsonrpc: "2.0", id: 2, method: "requestAirdrop" }]),
      ENV,
      upstream
    );
    expect(response.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("request validation", () => {
  it("rejects bad JSON, bad params, empty or oversized batches and oversized bodies", async () => {
    const upstream = upstreamReturning(ok(1, 1));
    expect((await handleSolanaRpc(call("{nope"), ENV, upstream)).status).toBe(400);
    expect((await handleSolanaRpc(call({ jsonrpc: "2.0", id: 1, method: "getSlot", params: { a: 1 } }), ENV, upstream)).status).toBe(400);
    expect((await handleSolanaRpc(call({ id: 1 }), ENV, upstream)).status).toBe(400);
    expect((await handleSolanaRpc(call([]), ENV, upstream)).status).toBe(400);
    const tooMany = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "getSlot" }));
    expect((await handleSolanaRpc(call(tooMany), ENV, upstream)).status).toBe(400);
    const big = { jsonrpc: "2.0", id: 1, method: "sendTransaction", params: ["A".repeat(MAX_BODY_BYTES)] };
    expect((await handleSolanaRpc(call(big), ENV, upstream)).status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("only accepts the site's own origin or an allowlisted one; no Origin only outside production", async () => {
    const body = { jsonrpc: "2.0", id: 1, method: "getSlot" };
    const upstream = upstreamReturning(ok(1, 1));
    expect((await handleSolanaRpc(call(body, { origin: "https://evil.example" }), ENV, upstream)).status).toBe(403);
    expect((await handleSolanaRpc(call(body, { origin: "not a url" }), ENV, upstream)).status).toBe(403);
    expect((await handleSolanaRpc(call(body, { origin: null }), ENV, upstream)).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();

    expect((await handleSolanaRpc(call(body, { origin: SITE }), ENV, upstream)).status).toBe(200);
    expect((await handleSolanaRpc(call(body, { origin: "https://preview.example" }), { ...ENV, RPC_PROXY_ALLOWED_ORIGINS: "https://preview.example" }, upstream)).status).toBe(200);
    expect((await handleSolanaRpc(call(body, { origin: null }), { ...ENV, NODE_ENV: "development" }, upstream)).status).toBe(200);
  });

  it("is not configured without a valid https RPC_FAST_URL", async () => {
    const upstream = upstreamReturning(ok(1, 1));
    const body = { jsonrpc: "2.0", id: 1, method: "getSlot" };
    for (const url of [undefined, "", "not a url", "http://solana-rpc.rpcfast.com/?api_key=abcdefgh"]) {
      const response = await handleSolanaRpc(call(body), { ...ENV, RPC_FAST_URL: url }, upstream);
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("abcdefgh");
    }
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("error mapping", () => {
  const body = { jsonrpc: "2.0", id: 42, method: "getSlot" };

  it("maps timeouts, network failures, auth, rate limit and 5xx, always keeping the request id", async () => {
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    const down = vi.fn(async () => {
      throw new Error(`getaddrinfo ENOTFOUND ${UPSTREAM}`);
    });
    const cases: Array<[ReturnType<typeof vi.fn>, number]> = [
      [timeout, 504],
      [down, 502],
      [upstreamReturning("forbidden", 403), 502],
      [upstreamReturning("unauthorized", 401), 502],
      [upstreamReturning("slow down", 429, { "retry-after": "3" }), 429],
      [upstreamReturning("boom", 500), 502],
      [upstreamReturning("<html>", 200), 502]
    ];
    for (const [fetchImpl, status] of cases) {
      const response = await handleSolanaRpc(call(body), ENV, fetchImpl as never);
      expect(response.status).toBe(status);
      const json = await response.json();
      expect(json.id).toBe(42);
      expect(json.error.message).toBeTypeOf("string");
    }
    const limited = await handleSolanaRpc(call(body), ENV, upstreamReturning("x", 429, { "retry-after": "3" }));
    expect(limited.headers.get("retry-after")).toBe("3");
  });

  it("passes a JSON-RPC error from upstream through unchanged (HTTP 200)", async () => {
    const raw = JSON.stringify({ jsonrpc: "2.0", id: 42, error: { code: -32002, message: "Transaction simulation failed" } });
    const response = await handleSolanaRpc(call(body), ENV, upstreamReturning(raw));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(raw);
  });
});

describe("secret redaction", () => {
  it("never returns the URL or key, whatever upstream or the network say", async () => {
    const body = { jsonrpc: "2.0", id: 1, method: "getSlot" };
    const echoes = [
      JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -1, message: `bad request to ${UPSTREAM}` } }),
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: { debug: KEY, url: "https://solana-rpc.rpcfast.com/?api_key=" + KEY } })
    ];
    const responses: Response[] = [];
    for (const raw of echoes) responses.push(await handleSolanaRpc(call(body), ENV, upstreamReturning(raw)));
    responses.push(await handleSolanaRpc(call(body), ENV, upstreamReturning(`denied for ${UPSTREAM}`, 403)));
    responses.push(await handleSolanaRpc(call(body), ENV, upstreamReturning(`oops ${KEY}`, 500)));
    responses.push(
      await handleSolanaRpc(call(body), ENV, vi.fn(async () => {
        throw new Error(`connect ECONNREFUSED ${UPSTREAM}`);
      }) as never)
    );
    const texts: string[] = [];
    for (const response of responses) {
      const text = await response.text();
      texts.push(text);
      expect(text).not.toContain(KEY);
      expect(text).not.toContain("api_key");
      expect(text).not.toContain("rpcfast.com");
      for (const [, value] of response.headers) expect(value).not.toContain(KEY);
    }
    // A 200 body that echoes the secret is scrubbed, not dropped, and stays valid JSON.
    expect(texts[0]).toContain("[redacted]");
    expect(JSON.parse(texts[1]!).result.debug).toBe("[redacted]");
  });

  it("scrubs keys carried in the URL path, userinfo or a header", () => {
    expect(scrub("see https://rpc.example/v2/abcdefghijklmnopqrstu done", { RPC_FAST_URL: "https://rpc.example/v2/abcdefghijklmnopqrstu" })).not.toContain("abcdefghijklmnopqrstu");
    expect(scrub("user:s3cretpass@", { RPC_FAST_URL: "https://user:s3cretpass@rpc.example/" })).not.toContain("s3cretpass");
    expect(scrub("hdr header-key-123456", { RPC_FAST_URL: "https://rpc.example/", RPC_FAST_API_KEY: "header-key-123456" })).not.toContain("header-key-123456");
  });

  it("does not log anything", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const body = { jsonrpc: "2.0", id: 1, method: "getSlot" };
    await handleSolanaRpc(call(body), ENV, upstreamReturning(ok(1, 1)));
    await handleSolanaRpc(call(body), ENV, vi.fn(async () => {
      throw new Error(UPSTREAM);
    }) as never);
    await handleSolanaRpc(call(body, { origin: "https://evil.example" }), ENV, upstreamReturning(ok(1, 1)));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("layer + reason headers (to trace a 403 to its layer)", () => {
  it("tags every refusal with the proxy layer and a fixed reason", async () => {
    const cases: Array<[Request, string, number]> = [
      [call({ jsonrpc: "2.0", id: 1, method: "getSlot" }, { origin: "https://evil.example" }), "origin-not-allowed", 403],
      [call({ jsonrpc: "2.0", id: 1, method: "getProgramAccounts" }), "method-not-allowed", 403]
    ];
    for (const [request, reason, status] of cases) {
      const response = await handleSolanaRpc(request, ENV, upstreamReturning("{}"));
      expect(response.status).toBe(status);
      expect(response.headers.get("x-upay3food-rpc-layer")).toBe("proxy");
      expect(response.headers.get("x-upay3food-rpc-reason")).toBe(reason);
    }
    const auth = await handleSolanaRpc(call({ jsonrpc: "2.0", id: 1, method: "getSlot" }), ENV, upstreamReturning("forbidden", 403));
    expect(auth.status).toBe(502);
    expect(auth.headers.get("x-upay3food-rpc-reason")).toBe("upstream-auth");
    const fine = await handleSolanaRpc(call({ jsonrpc: "2.0", id: 1, method: "getSlot" }), ENV, upstreamReturning(ok(1, 5)));
    expect(fine.headers.get("x-upay3food-rpc-layer")).toBe("proxy");
    expect(fine.headers.get("x-upay3food-rpc-reason")).toBeNull();
  });
});

describe("proxyHealth (read-only)", () => {
  const healthy = vi.fn(async (_url: string, init: RequestInit) => {
    const calls = JSON.parse(String(init.body)) as Array<{ id: number; method: string }>;
    expect(calls.map((c) => c.method)).toEqual(["getHealth", "getGenesisHash", "getSlot"]);
    return new Response(JSON.stringify([
      { jsonrpc: "2.0", id: 1, result: "ok" },
      { jsonrpc: "2.0", id: 2, result: MAINNET_GENESIS_HASH },
      { jsonrpc: "2.0", id: 3, result: 453_700_000 }
    ]));
  });

  it("reports proxy OK, upstream OK, mainnet-beta and the slot, without the endpoint", async () => {
    const health = await proxyHealth(ENV, healthy);
    expect(health).toMatchObject({ proxy: "OK", upstream: "OK", network: "mainnet-beta", slot: 453_700_000, upstreamHealth: "ok", upstreamReason: null });
    expect(JSON.stringify(health)).not.toContain(KEY);
  });

  it("names the failing layer: not configured, upstream auth", async () => {
    expect(await proxyHealth({ NODE_ENV: "production" }, healthy)).toMatchObject({ proxy: "NOT_CONFIGURED", upstream: "FAIL", upstreamReason: "not-configured" });
    expect(await proxyHealth(ENV, upstreamReturning("nope", 401))).toMatchObject({ proxy: "OK", upstream: "FAIL", upstreamReason: "upstream-auth" });
  });
});
