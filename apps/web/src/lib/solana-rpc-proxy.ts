/**
 * Same-origin Solana JSON-RPC proxy: the browser (Cloak SDK, balance reads) talks
 * to `POST /api/solana-rpc`; this module forwards to the RPC Fast endpoint
 * configured in server-side env, so the endpoint and its API key never reach
 * the client.
 *
 * Rules:
 *  - the upstream is ALWAYS `RPC_FAST_URL`; nothing in the request chooses it;
 *  - only an allowlist of methods is forwarded (reads the Cloak SDK and wallet
 *    balance checks use, plus sendTransaction for already-signed transactions);
 *  - the request body is forwarded verbatim, so JSON-RPC ids and params are
 *    preserved; the proxy never retries (a retried sendTransaction is not ours
 *    to decide);
 *  - upstream error bodies are not echoed, and every response is scrubbed of
 *    the secret values; nothing is logged.
 */

export const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  // Cloak SDK
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getBlockHeight",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getSignaturesForAddress",
  "getSignatureStatuses",
  "getSlot",
  "getTokenAccountBalance",
  "getTransaction",
  "sendTransaction",
  "simulateTransaction",
  "isBlockhashValid",
  "getFeeForMessage",
  "getRecentPrioritizationFees",
  // wallet balance checks
  "getTokenAccountsByOwner",
  // health
  "getHealth",
  "getGenesisHash"
]);

export const MAX_BODY_BYTES = 256 * 1024;
export const MAX_BATCH = 20;
export const UPSTREAM_TIMEOUT_MS = 20_000;

export interface ProxyEnv {
  RPC_FAST_URL?: string | undefined;
  /** Only when the key is sent as a header instead of in the URL. */
  RPC_FAST_API_KEY?: string | undefined;
  RPC_FAST_API_KEY_HEADER?: string | undefined;
  /** Extra browser origins allowed to call the proxy (comma separated), besides the site's own. */
  RPC_PROXY_ALLOWED_ORIGINS?: string | undefined;
  NODE_ENV?: string | undefined;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const REDACTED = "[redacted]";

/** Every value that must never leave the server: the full URL, userinfo, query values, long path segments and the header key. */
function secretsOf(env: ProxyEnv): string[] {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    if (v && v.length >= 6) out.add(v);
  };
  add(env.RPC_FAST_URL);
  add(env.RPC_FAST_API_KEY);
  try {
    const url = new URL(env.RPC_FAST_URL ?? "");
    add(url.username);
    add(url.password);
    for (const value of url.searchParams.values()) add(value);
    for (const segment of url.pathname.split("/")) if (segment.length >= 16) add(segment);
    add(url.search.replace(/^\?/, ""));
  } catch {
    /* not a URL: the checks below refuse it */
  }
  return [...out].sort((a, b) => b.length - a.length);
}

export function scrub(text: string, env: ProxyEnv): string {
  let out = text;
  for (const secret of secretsOf(env)) out = out.split(secret).join(REDACTED);
  return out;
}

function upstreamUrl(env: ProxyEnv): string | null {
  try {
    const url = new URL(env.RPC_FAST_URL ?? "");
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Every response from this proxy says so, and why it failed. The browser's
 * RPC client keeps the response headers in its error (Solana error #8100002
 * carries `headers` + `statusCode`), so a 403 can be traced to this layer —
 * or, when the header is absent, to something in front of it (Vercel) or to
 * another endpoint. Values are fixed tokens; never a URL, key or body.
 */
export const LAYER_HEADER = "x-upay3food-rpc-layer";
export const REASON_HEADER = "x-upay3food-rpc-reason";

export type ProxyFailureReason =
  | "not-configured"
  | "origin-not-allowed"
  | "method-not-allowed"
  | "too-large"
  | "invalid-request"
  | "upstream-timeout"
  | "upstream-unreachable"
  | "upstream-rate-limited"
  | "upstream-auth"
  | "upstream-error"
  | "upstream-non-json";

function rpcError(
  status: number,
  code: number,
  message: string,
  id: unknown = null,
  headers: Record<string, string> = {},
  reason: ProxyFailureReason = "invalid-request"
): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", [LAYER_HEADER]: "proxy", [REASON_HEADER]: reason, ...headers }
  });
}

/** Same site, or an explicitly allowed origin. A request without Origin is only accepted outside production. */
function originAllowed(request: Request, env: ProxyEnv): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return env.NODE_ENV !== "production";
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const own = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  if (host === own) return true;
  return (env.RPC_PROXY_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(origin);
}

interface RpcCall {
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

function validate(call: unknown): { ok: true } | { ok: false; id: unknown; code: number; message: string; status: number } {
  const c = (call && typeof call === "object" && !Array.isArray(call) ? call : {}) as RpcCall;
  const id = c.id ?? null;
  if (typeof c.method !== "string") return { ok: false, id, code: -32600, message: "Invalid request", status: 400 };
  if (!ALLOWED_METHODS.has(c.method)) return { ok: false, id, code: -32601, message: "Method not allowed", status: 403 };
  if (c.params !== undefined && !Array.isArray(c.params)) return { ok: false, id, code: -32602, message: "Invalid params", status: 400 };
  return { ok: true };
}

export async function handleSolanaRpc(request: Request, env: ProxyEnv, fetchImpl: Fetch = fetch): Promise<Response> {
  const target = upstreamUrl(env);
  if (!target) return rpcError(503, -32000, "RPC proxy is not configured", null, {}, "not-configured");
  if (!originAllowed(request, env)) return rpcError(403, -32000, "Origin not allowed", null, {}, "origin-not-allowed");

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return rpcError(413, -32000, "Request too large", null, {}, "too-large");
  const text = await request.text().catch(() => null);
  if (text === null) return rpcError(400, -32700, "Parse error");
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return rpcError(413, -32000, "Request too large", null, {}, "too-large");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return rpcError(400, -32700, "Parse error");
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  if (calls.length === 0 || calls.length > MAX_BATCH) return rpcError(400, -32600, "Invalid request");
  for (const call of calls) {
    const verdict = validate(call);
    if (!verdict.ok) {
      return rpcError(verdict.status, verdict.code, verdict.message, Array.isArray(parsed) ? null : verdict.id, {}, verdict.code === -32601 ? "method-not-allowed" : "invalid-request");
    }
  }
  const id = Array.isArray(parsed) ? null : ((parsed as RpcCall).id ?? null);

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (env.RPC_FAST_API_KEY) headers[env.RPC_FAST_API_KEY_HEADER || "x-api-key"] = env.RPC_FAST_API_KEY;

  let upstream: Response;
  try {
    upstream = await fetchImpl(target, {
      method: "POST",
      headers,
      body: text,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") return rpcError(504, -32003, "RPC upstream timed out", id, {}, "upstream-timeout");
    return rpcError(502, -32002, "RPC upstream unreachable", id, {}, "upstream-unreachable");
  }

  if (upstream.status === 429) {
    const retryAfter = upstream.headers.get("retry-after");
    return rpcError(429, -32005, "RPC upstream rate limited", id, retryAfter && /^\d+$/.test(retryAfter) ? { "retry-after": retryAfter } : {}, "upstream-rate-limited");
  }
  if (upstream.status === 401 || upstream.status === 403) return rpcError(502, -32001, "RPC upstream rejected the proxy's credentials", id, {}, "upstream-auth");
  if (upstream.status !== 200) return rpcError(502, -32002, `RPC upstream error (HTTP ${upstream.status})`, id, {}, "upstream-error");

  const body = scrub(await upstream.text(), env);
  try {
    JSON.parse(body);
  } catch {
    return rpcError(502, -32002, "RPC upstream returned a non-JSON response", id, {}, "upstream-non-json");
  }
  return new Response(body, { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store", [LAYER_HEADER]: "proxy" } });
}

// ---------------------------------------------------------------------------
// Health (read-only): does the proxy work, and does the upstream answer?
// ---------------------------------------------------------------------------

/** Solana mainnet-beta genesis hash. */
export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export interface ProxyHealth {
  proxy: "OK" | "NOT_CONFIGURED";
  upstream: "OK" | "FAIL";
  /** Why the upstream failed, as the proxy classifies it. */
  upstreamReason: ProxyFailureReason | "unexpected-response" | null;
  network: "mainnet-beta" | "other" | "unknown";
  slot: number | null;
  upstreamHealth: string | null;
  latencyMs: number | null;
  checkedAt: string;
}

/**
 * Three read-only calls through the same forwarding path as the browser:
 * getHealth, getGenesisHash, getSlot. No transaction, no caller input, no
 * secret in the result (it is built from fixed fields only).
 */
export async function proxyHealth(env: ProxyEnv, fetchImpl: Fetch = fetch, now: () => number = Date.now): Promise<ProxyHealth> {
  const checkedAt = new Date(now()).toISOString();
  const base = { slot: null, upstreamHealth: null, latencyMs: null, checkedAt };
  if (!upstreamUrl(env)) return { proxy: "NOT_CONFIGURED", upstream: "FAIL", upstreamReason: "not-configured", network: "unknown", ...base };
  const site = "https://health.internal";
  const request = new Request(`${site}/api/solana-rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: site },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "getHealth" },
      { jsonrpc: "2.0", id: 2, method: "getGenesisHash" },
      { jsonrpc: "2.0", id: 3, method: "getSlot", params: [{ commitment: "confirmed" }] }
    ])
  });
  const started = now();
  const response = await handleSolanaRpc(request, env, fetchImpl);
  const latencyMs = now() - started;
  if (response.status !== 200) {
    return { proxy: "OK", upstream: "FAIL", upstreamReason: (response.headers.get(REASON_HEADER) as ProxyFailureReason | null) ?? "upstream-error", network: "unknown", ...base, latencyMs };
  }
  try {
    const results = (await response.json()) as Array<{ id: number; result?: unknown; error?: { message?: string } }>;
    const byId = new Map(results.map((r) => [r.id, r]));
    const genesis = byId.get(2)?.result;
    const slot = byId.get(3)?.result;
    const health = byId.get(1);
    return {
      proxy: "OK",
      upstream: typeof slot === "number" ? "OK" : "FAIL",
      upstreamReason: typeof slot === "number" ? null : "unexpected-response",
      network: genesis === MAINNET_GENESIS_HASH ? "mainnet-beta" : typeof genesis === "string" ? "other" : "unknown",
      slot: typeof slot === "number" ? slot : null,
      upstreamHealth: typeof health?.result === "string" ? health.result : health?.error ? "unhealthy" : null,
      latencyMs,
      checkedAt
    };
  } catch {
    return { proxy: "OK", upstream: "FAIL", upstreamReason: "unexpected-response", network: "unknown", ...base, latencyMs };
  }
}
