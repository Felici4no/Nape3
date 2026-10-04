import type { IncomingMessage, ServerResponse } from "node:http";
import { cents, type ProductCategory } from "@nape3/domain";
import { compareCheckout, sanitizeObservation, summarizeMarket, type MarketSummary } from "@nape3/market";
import type { ObservationStore } from "./store";

/**
 * Observation network API (MVP).
 *
 *   POST /v1/observations      ingest one sanitized, non-synthetic observation
 *   GET  /v1/market/summary    aggregated stats for a product requirement
 *   POST /v1/market/compare    observational comparison for a checkout total
 *   GET  /healthz
 *
 * Not production-ready: no authentication, no Sybil resistance, in-memory
 * rate limiting only. See docs/05-architecture/observation-network.md.
 */

const MAX_BODY = 32 * 1024;
const CATEGORIES: readonly ProductCategory[] = ["acai"];

export interface AppOptions {
  now?: () => Date;
  /** Requests per minute per client IP. */
  rateLimitPerMinute?: number;
  log?: (entry: Record<string, unknown>) => void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function intParam(params: URLSearchParams, name: string, fallback?: number): number | undefined {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) throw new HttpError(400, `${name} must be a non-negative integer`);
  return value;
}

/** Public view of a summary: aggregate numbers only, no per-observer ids. */
function publicSummary(summary: MarketSummary) {
  const { comparable, excluded, ...stats } = summary;
  return {
    ...stats,
    observations: comparable.map((o) => ({
      source: o.source,
      totalCents: o.quote.totalCents,
      observedAt: o.observedAt,
      marketRegion: o.context.marketRegion ?? null,
      provenance: o.provenance.method
    })),
    excludedCount: excluded.length
  };
}

function query(params: URLSearchParams, now: Date) {
  const category = params.get("category") as ProductCategory | null;
  if (!category || !CATEGORIES.includes(category)) throw new HttpError(400, "category must be one of: acai");
  const volumeMl = intParam(params, "volumeMl");
  const region = params.get("region") ?? undefined;
  return {
    requirement: { category, ...(volumeMl !== undefined ? { volumeMl } : {}) },
    quantity: intParam(params, "quantity", 1)!,
    now,
    freshWithinMinutes: intParam(params, "freshMinutes", 60)!,
    provenance: "real-only" as const,
    ...(region ? { marketRegion: region } : {})
  };
}

export function createApp(store: ObservationStore, options: AppOptions = {}) {
  const now = options.now ?? (() => new Date());
  const limit = options.rateLimitPerMinute ?? 60;
  const log = options.log ?? ((entry) => console.log(JSON.stringify({ ts: now().toISOString(), scope: "observer-api", ...entry })));
  const hits = new Map<string, { windowStart: number; count: number }>();

  function rateLimited(ip: string): boolean {
    const t = now().getTime();
    const entry = hits.get(ip);
    if (!entry || t - entry.windowStart >= 60_000) {
      hits.set(ip, { windowStart: t, count: 1 });
      return false;
    }
    entry.count += 1;
    return entry.count > limit;
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const origin = req.headers.origin;
    if (origin && /^chrome-extension:\/\//.test(origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("access-control-allow-headers", "content-type");
      res.setHeader("access-control-allow-methods", "GET, POST");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    try {
      if (rateLimited(req.socket.remoteAddress ?? "unknown")) throw new HttpError(429, "rate limited");

      if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });

      if (req.method === "POST" && url.pathname === "/v1/observations") {
        const result = sanitizeObservation(await readJson(req));
        if (!result.ok) throw new HttpError(422, "invalid observation", result.errors);
        if (result.observation.provenance.synthetic) {
          throw new HttpError(422, "synthetic observations are not accepted by the network");
        }
        const created = await store.add(result.observation);
        log({ event: "observation.ingested", created, kind: result.observation.kind, source: result.observation.source });
        return send(res, created ? 201 : 200, { ok: true, id: result.observation.id, created });
      }

      if (req.method === "GET" && url.pathname === "/v1/market/summary") {
        const summary = summarizeMarket(await store.all(), query(url.searchParams, now()));
        return send(res, 200, publicSummary(summary));
      }

      if (req.method === "POST" && url.pathname === "/v1/market/compare") {
        const body = (await readJson(req)) as Record<string, unknown>;
        if (typeof body.totalCents !== "number" || !Number.isSafeInteger(body.totalCents)) {
          throw new HttpError(400, "totalCents must be integer cents");
        }
        const params = new URLSearchParams();
        for (const key of ["category", "volumeMl", "quantity", "region", "freshMinutes"]) {
          if (body[key] !== undefined) params.set(key, String(body[key]));
        }
        const summary = summarizeMarket(await store.all(), query(params, now()));
        return send(res, 200, { comparison: compareCheckout(cents(body.totalCents), summary), summary: publicSummary(summary) });
      }

      throw new HttpError(404, "not found");
    } catch (error) {
      if (error instanceof HttpError) {
        return send(res, error.status, { ok: false, error: error.message, ...(error.details ? { details: error.details } : {}) });
      }
      log({ event: "request.failed", error: error instanceof Error ? error.message : String(error) });
      return send(res, 500, { ok: false, error: "internal error" });
    }
  };
}
