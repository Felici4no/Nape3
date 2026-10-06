import { afterEach, describe, expect, it } from "vitest";
import { SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, SolanaError } from "@solana/kit";
import { classifyFailure, classifyHttpFailure, clearRpcTrace, endpointKind, rpcTrace, tracedTransport } from "./rpc-trace";

/** Exactly what kit throws for a non-2xx answer: Solana error #8100002 with statusCode + headers. */
function http(status: number, headers: Record<string, string> = {}) {
  return new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers: new Headers(headers), message: "", statusCode: status });
}

afterEach(() => clearRpcTrace());

describe("classifying Solana error #8100002 (HTTP) by the layer that answered", () => {
  const proxy = (reason: string) => ({ "x-upay3food-rpc-layer": "proxy", "x-upay3food-rpc-reason": reason });

  it("the user's error: 403 with no proxy marker from a public endpoint is PUBLIC_RPC_403", () => {
    expect(classifyFailure(http(403), "public-rpc")).toBe("PUBLIC_RPC_403");
  });

  it("403s from our proxy say which rule refused them", () => {
    expect(classifyFailure(http(403, proxy("origin-not-allowed")))).toBe("RPC_PROXY_ORIGIN_403");
    expect(classifyFailure(http(403, proxy("method-not-allowed")))).toBe("RPC_PROXY_METHOD_403");
  });

  it("a 401/403 for the same-origin path without our marker came from in front of the proxy (Vercel)", () => {
    expect(classifyFailure(http(403, { server: "Vercel" }), "same-origin-rpc")).toBe("VERCEL_PROTECTION_403");
    expect(classifyFailure(http(401, { "x-vercel-id": "gru1::abc" }), "same-origin-rpc")).toBe("VERCEL_PROTECTION_403");
  });

  it("upstream failures are told apart from the proxy's own refusals", () => {
    expect(classifyFailure(http(502, proxy("upstream-auth")))).toBe("RPC_UPSTREAM_AUTH_FAILURE");
    expect(classifyFailure(http(429, proxy("upstream-rate-limited")))).toBe("RPC_RATE_LIMIT");
    expect(classifyFailure(http(429), "public-rpc")).toBe("RPC_RATE_LIMIT");
    expect(classifyFailure(http(504, proxy("upstream-timeout")))).toBe("RPC_NETWORK_FAILURE");
    expect(classifyFailure(http(503, proxy("not-configured")))).toBe("RPC_PROXY_NOT_CONFIGURED");
  });

  it("wallet and relay failures are not RPC failures", () => {
    expect(classifyFailure(Object.assign(new Error("User rejected the request."), { code: 4001 }))).toBe("WALLET_PROVIDER_FAILURE");
    expect(classifyFailure(new Error("RelayInternalError: Relay returned an error: boom"))).toBe("CLOAK_RELAY_FAILURE");
    expect(classifyFailure(new TypeError("Failed to fetch"))).toBe("RPC_NETWORK_FAILURE");
  });

  it("no answer at all is a network failure", () => {
    expect(classifyHttpFailure({ endpoint: "same-origin-rpc", status: null, layer: null, reason: null, viaVercel: false })).toBe("RPC_NETWORK_FAILURE");
  });
});

describe("endpointKind never records the URL, only what it is", () => {
  it("same origin, public Solana, anything else", () => {
    expect(endpointKind("https://upay3food.com/api/solana-rpc", "https://upay3food.com")).toBe("same-origin-rpc");
    expect(endpointKind("https://api.mainnet-beta.solana.com", "https://upay3food.com")).toBe("public-rpc");
    expect(endpointKind("https://solana-rpc.rpcfast.com/?api_key=SECRET", "https://upay3food.com")).toBe("custom-rpc");
  });
});

describe("tracedTransport", () => {
  it("records method, status, JSON-RPC error code, timing and stage — never params", async () => {
    let t = 1_000;
    const transport = tracedTransport(async () => ({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad" } }), "same-origin-rpc", "wallet.balances", () => (t += 25));
    await transport({ payload: { jsonrpc: "2.0", id: 1, method: "getBalance", params: ["9qAezschd4e5t5yi9F5SAw41g43Vuj6iYMh7dpcKqkUi"] } });
    const [entry] = rpcTrace();
    expect(entry).toMatchObject({ endpoint: "same-origin-rpc", method: "getBalance", httpStatus: 200, rpcErrorCode: -32602, durationMs: 25, stage: "wallet.balances", classification: null });
    expect(JSON.stringify(entry)).not.toContain("9qAez");
  });

  it("classifies and re-throws an HTTP failure", async () => {
    const error = http(403, { "x-upay3food-rpc-layer": "proxy", "x-upay3food-rpc-reason": "origin-not-allowed" });
    const transport = tracedTransport(async () => Promise.reject(error), "same-origin-rpc", "shield.deposit");
    await expect(transport({ payload: [{ method: "getSlot" }, { method: "getBlockHeight" }] })).rejects.toBe(error);
    expect(rpcTrace()[0]).toMatchObject({ method: "getSlot+getBlockHeight", httpStatus: 403, classification: "RPC_PROXY_ORIGIN_403" });
  });
});
