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

function rpcError(status: number, code: number, message: string, id: unknown = null, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers }
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
  if (!target) return rpcError(503, -32000, "RPC proxy is not configured");
  if (!originAllowed(request, env)) return rpcError(403, -32000, "Origin not allowed");

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return rpcError(413, -32000, "Request too large");
  const text = await request.text().catch(() => null);
  if (text === null) return rpcError(400, -32700, "Parse error");
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return rpcError(413, -32000, "Request too large");

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
    if (!verdict.ok) return rpcError(verdict.status, verdict.code, verdict.message, Array.isArray(parsed) ? null : verdict.id);
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
    if (name === "TimeoutError" || name === "AbortError") return rpcError(504, -32003, "RPC upstream timed out", id);
    return rpcError(502, -32002, "RPC upstream unreachable", id);
  }

  if (upstream.status === 429) {
    const retryAfter = upstream.headers.get("retry-after");
    return rpcError(429, -32005, "RPC upstream rate limited", id, retryAfter && /^\d+$/.test(retryAfter) ? { "retry-after": retryAfter } : {});
  }
  if (upstream.status === 401 || upstream.status === 403) return rpcError(502, -32001, "RPC upstream rejected the proxy's credentials", id);
  if (upstream.status !== 200) return rpcError(502, -32002, `RPC upstream error (HTTP ${upstream.status})`, id);

  const body = scrub(await upstream.text(), env);
  try {
    JSON.parse(body);
  } catch {
    return rpcError(502, -32002, "RPC upstream returned a non-JSON response", id);
  }
  return new Response(body, { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
