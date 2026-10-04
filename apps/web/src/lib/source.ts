import type { MarketObservation } from "@nape3/domain";
import { marketFixtures } from "@nape3/fixtures";
import { sanitizeObservation } from "@nape3/market";

/**
 * The one market source every page and API route reads from.
 *
 *   live  real observations from apps/observer-api (extension captures).
 *         Never contains synthetic data: anything flagged synthetic is dropped.
 *   demo  synthetic fixtures only, always labelled as such.
 *
 * The two are never mixed. Live is chosen automatically whenever
 * OBSERVER_API_URL is configured; demo is a labelled fallback when it is not,
 * or an explicit development switch. When live is selected but unreachable or
 * quiet, the result is an empty live market, never fixtures.
 *
 * Kept free of Next.js imports so it can be tested directly; the request-bound
 * wrapper lives in `source.server.ts`.
 */

export type DataMode = "live" | "demo";

export interface SourceEnv {
  OBSERVER_API_URL?: string;
  OBSERVER_READ_TOKEN?: string;
  /** "live" or "demo" to pin the mode; unset → live when OBSERVER_API_URL is set. */
  MARKET_DATA?: string;
  NODE_ENV?: string;
  /** Allow the demo switch in a production build (e.g. a public demo deployment). */
  ALLOW_DEMO_TOGGLE?: string;
}

export interface ModeResolution {
  mode: DataMode;
  /** Why this mode was chosen, shown in the data banner. */
  reason: "observer-configured" | "no-observer-configured" | "pinned-by-env" | "dev-switch";
  /** Whether the development switch may be used in this deployment. */
  switchAllowed: boolean;
}

export interface MarketSource extends ModeResolution {
  /** ok: observations loaded; empty: live source reachable but no data; unavailable: live source failed. */
  status: "ok" | "empty" | "unavailable";
  observations: MarketObservation[];
  origin: "observer-api" | "fixtures";
  fetchedAt: string;
  /** Live window requested from the API. */
  windowMinutes: number;
  /** Observations refused by the web side (invalid, or synthetic in live mode). */
  dropped: number;
  error: string | null;
}

export const DATA_COOKIE = "u3_data";
/** Observations older than this are not fetched at all; staleness within it is decided per quote. */
export const LIVE_WINDOW_MINUTES = 7 * 24 * 60;
const FETCH_TIMEOUT_MS = 4_000;

export function demoSwitchAllowed(env: SourceEnv): boolean {
  return env.NODE_ENV !== "production" || env.ALLOW_DEMO_TOGGLE === "1";
}

export function resolveMode(env: SourceEnv, cookie: string | undefined): ModeResolution {
  const switchAllowed = demoSwitchAllowed(env);
  if (switchAllowed && (cookie === "demo" || cookie === "live")) return { mode: cookie, reason: "dev-switch", switchAllowed };
  if (env.MARKET_DATA === "demo" || env.MARKET_DATA === "live") return { mode: env.MARKET_DATA, reason: "pinned-by-env", switchAllowed };
  return env.OBSERVER_API_URL
    ? { mode: "live", reason: "observer-configured", switchAllowed }
    : { mode: "demo", reason: "no-observer-configured", switchAllowed };
}

/**
 * Validates what the observer API returned. Re-sanitizes every observation
 * (allowlist) and drops anything synthetic: live mode must never include it.
 */
export function acceptLive(raw: unknown): { observations: MarketObservation[]; dropped: number } {
  const list = Array.isArray(raw) ? raw : [];
  const observations: MarketObservation[] = [];
  let dropped = 0;
  for (const item of list) {
    const result = sanitizeObservation(item);
    if (!result.ok || result.observation.provenance.synthetic) {
      dropped += 1;
      continue;
    }
    observations.push(result.observation);
  }
  return { observations, dropped };
}

export interface LoadOptions {
  env: SourceEnv;
  cookie?: string;
  now: Date;
  fetchImpl?: typeof fetch;
}

export async function loadMarketSource({ env, cookie, now, fetchImpl = fetch }: LoadOptions): Promise<MarketSource> {
  const resolution = resolveMode(env, cookie);
  const base = { ...resolution, fetchedAt: now.toISOString(), windowMinutes: LIVE_WINDOW_MINUTES, dropped: 0 };

  if (resolution.mode === "demo") {
    return { ...base, status: "ok", observations: marketFixtures(now), origin: "fixtures", error: null };
  }

  const unavailable = (error: string): MarketSource => ({ ...base, status: "unavailable", observations: [], origin: "observer-api", error });
  if (!env.OBSERVER_API_URL) return unavailable("OBSERVER_API_URL is not configured");

  let url: URL;
  try {
    url = new URL("/v1/observations", env.OBSERVER_API_URL);
  } catch {
    return unavailable("OBSERVER_API_URL is not a valid URL");
  }
  url.searchParams.set("sinceMinutes", String(LIVE_WINDOW_MINUTES));
  url.searchParams.set("provenance", "real");
  url.searchParams.set("limit", "5000");

  try {
    const response = await fetchImpl(url, {
      headers: env.OBSERVER_READ_TOKEN ? { authorization: `Bearer ${env.OBSERVER_READ_TOKEN}` } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) return unavailable(`observer API answered ${response.status}`);
    const body = (await response.json()) as { observations?: unknown };
    const { observations, dropped } = acceptLive(body.observations);
    if (dropped > 0) console.warn(JSON.stringify({ scope: "web.market-source", event: "observations.dropped", dropped }));
    return { ...base, status: observations.length ? "ok" : "empty", observations, origin: "observer-api", dropped, error: null };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return unavailable(name === "TimeoutError" || name === "AbortError" ? "observer API timed out" : "observer API unreachable");
  }
}

/** Serializable description of the source, for API responses and the client. */
export function describeSource(source: MarketSource) {
  return {
    mode: source.mode,
    status: source.status,
    synthetic: source.mode === "demo",
    origin: source.origin,
    reason: source.reason,
    fetchedAt: source.fetchedAt,
    windowMinutes: source.windowMinutes,
    observationCount: source.observations.length,
    dropped: source.dropped,
    error: source.error,
    switchAllowed: source.switchAllowed
  };
}

export type SourceInfo = ReturnType<typeof describeSource>;
