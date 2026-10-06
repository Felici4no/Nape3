import { isSolanaError } from "@solana/kit";

/**
 * Where a Solana RPC failure came from. "HTTP 403" alone (Solana error
 * #8100002, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) can be any of these:
 *
 *   RPC_PROXY_ORIGIN_403      our /api/solana-rpc refused the page's Origin
 *   RPC_PROXY_METHOD_403      our proxy refused a JSON-RPC method (allowlist)
 *   VERCEL_PROTECTION_403     a 401/403 for the same-origin proxy that our proxy did not produce
 *                             (Vercel Deployment Protection / firewall in front of it)
 *   PUBLIC_RPC_403            a public endpoint (api.mainnet-beta.solana.com) refused the browser
 *   RPC_UPSTREAM_AUTH_FAILURE RPC Fast rejected the proxy's credentials
 *   RPC_RATE_LIMIT            429 from the proxy (upstream) or a public endpoint
 *   RPC_NETWORK_FAILURE       the request never got an HTTP answer, or upstream timed out/unreachable
 *   RPC_PROXY_NOT_CONFIGURED  RPC_FAST_URL missing on the server
 *   RPC_HTTP_ERROR            any other HTTP failure
 *   WALLET_PROVIDER_FAILURE   the wallet (Phantom) refused or failed, not the RPC
 *   CLOAK_RELAY_FAILURE       the Cloak relay (api.cloak.ag), not the RPC
 *
 * The proxy tags every response with x-upay3food-rpc-layer / -reason; the
 * kit keeps response headers in the error, so the class is read from there.
 */
export type RpcFailureClass =
  | "RPC_PROXY_ORIGIN_403"
  | "RPC_PROXY_METHOD_403"
  | "VERCEL_PROTECTION_403"
  | "PUBLIC_RPC_403"
  | "RPC_UPSTREAM_AUTH_FAILURE"
  | "RPC_RATE_LIMIT"
  | "RPC_NETWORK_FAILURE"
  | "RPC_PROXY_NOT_CONFIGURED"
  | "RPC_HTTP_ERROR"
  | "WALLET_PROVIDER_FAILURE"
  | "CLOAK_RELAY_FAILURE";

/** Logical endpoint names: the URL itself is never recorded (a custom one could carry a key). */
export type RpcEndpointKind = "same-origin-rpc" | "public-rpc" | "custom-rpc";

export function endpointKind(url: string, pageOrigin: string | null): RpcEndpointKind {
  try {
    const u = new URL(url, pageOrigin ?? undefined);
    if (pageOrigin && u.origin === pageOrigin) return "same-origin-rpc";
    if (/(^|\.)solana\.com$/.test(u.hostname)) return "public-rpc";
  } catch {
    /* fall through */
  }
  return "custom-rpc";
}

export interface HttpFailure {
  endpoint: RpcEndpointKind;
  status: number | null;
  /** Value of x-upay3food-rpc-layer ("proxy") if present. */
  layer: string | null;
  reason: string | null;
  /** Response came through Vercel's edge (server: Vercel / x-vercel-id). */
  viaVercel: boolean;
}

export function classifyHttpFailure(f: HttpFailure): RpcFailureClass {
  if (f.status === null) return "RPC_NETWORK_FAILURE";
  if (f.layer === "proxy") {
    switch (f.reason) {
      case "origin-not-allowed":
        return "RPC_PROXY_ORIGIN_403";
      case "method-not-allowed":
        return "RPC_PROXY_METHOD_403";
      case "upstream-auth":
        return "RPC_UPSTREAM_AUTH_FAILURE";
      case "upstream-rate-limited":
        return "RPC_RATE_LIMIT";
      case "upstream-timeout":
      case "upstream-unreachable":
        return "RPC_NETWORK_FAILURE";
      case "not-configured":
        return "RPC_PROXY_NOT_CONFIGURED";
      default:
        return "RPC_HTTP_ERROR";
    }
  }
  if (f.status === 429) return "RPC_RATE_LIMIT";
  if (f.status === 401 || f.status === 403) {
    if (f.endpoint === "public-rpc") return "PUBLIC_RPC_403";
    if (f.endpoint === "same-origin-rpc") return "VERCEL_PROTECTION_403";
  }
  return "RPC_HTTP_ERROR";
}

function headerOf(headers: unknown, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
  const record = headers as Record<string, string>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name);
  return key ? String(record[key]) : null;
}

/** Reads status + our headers out of a kit HTTP transport error (#8100002). */
export function httpFailureOf(error: unknown, endpoint: RpcEndpointKind): HttpFailure | null {
  if (!isSolanaError(error)) return null;
  const context = (error as { context?: { statusCode?: unknown; headers?: unknown } }).context ?? {};
  if (typeof context.statusCode !== "number") return null;
  const headers = context.headers;
  return {
    endpoint,
    status: context.statusCode,
    layer: headerOf(headers, "x-upay3food-rpc-layer"),
    reason: headerOf(headers, "x-upay3food-rpc-reason"),
    viaVercel: !!(headerOf(headers, "x-vercel-id") || /vercel/i.test(headerOf(headers, "server") ?? ""))
  };
}

/** Any error the money screens can show: RPC, wallet or relay. */
export function classifyFailure(error: unknown, endpoint: RpcEndpointKind = "same-origin-rpc"): RpcFailureClass {
  const http = httpFailureOf(error, endpoint);
  if (http) return classifyHttpFailure(http);
  const e = error as { code?: unknown; message?: unknown; name?: unknown } | null;
  const message = String(e?.message ?? "");
  if (e?.code === 4001 || /user rejected|wallet|phantom|signTransaction|signMessage/i.test(message)) return "WALLET_PROVIDER_FAILURE";
  if (/relay|api\.cloak\.ag|RelayInternalError|range-quote|supplemental-alt/i.test(`${String(e?.name ?? "")} ${message}`)) return "CLOAK_RELAY_FAILURE";
  if (/fetch failed|network|Failed to fetch/i.test(message)) return "RPC_NETWORK_FAILURE";
  return "RPC_HTTP_ERROR";
}

// ---------------------------------------------------------------------------
// Request trace (debug): what each RPC request did, without secrets
// ---------------------------------------------------------------------------

export interface RpcTraceEntry {
  requestId: string;
  timestamp: string;
  endpoint: RpcEndpointKind;
  /** JSON-RPC method(s); a batch is joined with "+". */
  method: string;
  httpStatus: number | null;
  rpcErrorCode: number | null;
  durationMs: number;
  originHost: string | null;
  /** The screen/step that issued it ("wallet.balances", "shield.deposit"…). */
  stage: string;
  classification: RpcFailureClass | null;
}

const MAX_TRACE = 100;
const trace: RpcTraceEntry[] = [];
const listeners = new Set<(entries: readonly RpcTraceEntry[]) => void>();
let seq = 0;

export function rpcTrace(): readonly RpcTraceEntry[] {
  return trace;
}

export function onRpcTrace(listener: (entries: readonly RpcTraceEntry[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function recordRpcTrace(entry: Omit<RpcTraceEntry, "requestId">): RpcTraceEntry {
  const full = { requestId: `rpc-${Date.now().toString(36)}-${(++seq).toString(36)}`, ...entry };
  trace.push(full);
  if (trace.length > MAX_TRACE) trace.splice(0, trace.length - MAX_TRACE);
  for (const listener of listeners) listener(trace);
  return full;
}

export function clearRpcTrace(): void {
  trace.length = 0;
  for (const listener of listeners) listener(trace);
}

type BaseTransport = (config: { payload: unknown; signal?: AbortSignal }) => Promise<unknown>;

function methodsOf(payload: unknown): string {
  const calls = Array.isArray(payload) ? payload : [payload];
  return calls.map((c) => (c && typeof c === "object" && typeof (c as { method?: unknown }).method === "string" ? (c as { method: string }).method : "?")).join("+");
}

function rpcErrorCodeOf(response: unknown): number | null {
  const first = Array.isArray(response) ? response.find((r) => r && typeof r === "object" && "error" in r) : response;
  const code = (first as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === "number" ? code : null;
}

/** Wraps a JSON-RPC transport: records method, status, JSON-RPC error code and timing. Never the params or the URL. */
export function tracedTransport(base: BaseTransport, endpoint: RpcEndpointKind, stage: string, now: () => number = Date.now): BaseTransport {
  return async (config) => {
    const started = now();
    const method = methodsOf(config.payload);
    const originHost = typeof location !== "undefined" ? location.host : null;
    try {
      const response = await base(config);
      const rpcErrorCode = rpcErrorCodeOf(response);
      recordRpcTrace({ timestamp: new Date(started).toISOString(), endpoint, method, httpStatus: 200, rpcErrorCode, durationMs: now() - started, originHost, stage, classification: null });
      return response;
    } catch (error) {
      const http = httpFailureOf(error, endpoint);
      recordRpcTrace({
        timestamp: new Date(started).toISOString(),
        endpoint,
        method,
        httpStatus: http?.status ?? null,
        rpcErrorCode: null,
        durationMs: now() - started,
        originHost,
        stage,
        classification: http ? classifyHttpFailure(http) : "RPC_NETWORK_FAILURE"
      });
      throw error;
    }
  };
}
