import { subtractCents, type Cents, type MarketObservation } from "@nape3/domain";
import { summarizeMarket, type MarketQuery } from "./summary";

export interface PriceChange {
  currentMedianCents: Cents;
  previousMedianCents: Cents;
  changeCents: Cents;
  /** Change in basis points of the previous median (−250 = −2.5 %). */
  changeBps: number;
  currentSampleSize: number;
  previousSampleSize: number;
  lagMinutes: number;
  windowMinutes: number;
}

export interface PriceChangeOptions {
  /** How far back the comparison window is (default 24 h). */
  lagMinutes?: number;
  /** Width of both windows (default: the query's freshness window). */
  windowMinutes?: number;
  /** Minimum sample in EACH window (default 3). */
  minSampleSize?: number;
}

/**
 * Median now vs median `lagMinutes` ago, over the same comparable product.
 * Returns null unless both windows have enough observations: price movement
 * is never shown without historical data to support it.
 */
export function priceChange(
  observations: readonly MarketObservation[],
  query: MarketQuery,
  options: PriceChangeOptions = {}
): PriceChange | null {
  const lagMinutes = options.lagMinutes ?? 24 * 60;
  const windowMinutes = options.windowMinutes ?? query.freshWithinMinutes ?? 60;
  const minSampleSize = options.minSampleSize ?? 3;
  const thenMs = query.now.getTime() - lagMinutes * 60_000;

  const current = summarizeMarket(observations, { ...query, freshWithinMinutes: windowMinutes, minSampleSize });
  // Observations after "then" must not leak into the previous window.
  const before = observations.filter((o) => Date.parse(o.observedAt) <= thenMs);
  const previous = summarizeMarket(before, { ...query, now: new Date(thenMs), freshWithinMinutes: windowMinutes, minSampleSize });

  if (!current.sufficient || !previous.sufficient || current.medianCents === null || previous.medianCents === null) return null;
  const changeCents = subtractCents(current.medianCents, previous.medianCents);
  return {
    currentMedianCents: current.medianCents,
    previousMedianCents: previous.medianCents,
    changeCents,
    changeBps: Math.round((changeCents * 10_000) / previous.medianCents),
    currentSampleSize: current.sampleSize,
    previousSampleSize: previous.sampleSize,
    lagMinutes,
    windowMinutes
  };
}
