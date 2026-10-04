import {
  ageMinutes,
  cents,
  formatBRL,
  medianCents,
  provenanceClass,
  quoteMatchesRequirement,
  subtractCents,
  type Cents,
  type CartQuoteObservation,
  type MarketObservation,
  type ProductRequirement,
  type ProvenanceClass
} from "@nape3/domain";

export type ProvenancePolicy =
  /** Only non-synthetic observations (live, manual, partner). Default. */
  | "real-only"
  /** Real + synthetic; the summary is flagged `containsSynthetic`. */
  | "include-synthetic"
  /** Only synthetic fixtures (tests/demos). */
  | "synthetic-only";

export interface MarketQuery {
  requirement: ProductRequirement;
  quantity: number;
  now: Date;
  /** Observations newer than this count as fresh. Default 60 min. */
  freshWithinMinutes?: number;
  /** Restrict the headline statistics to one coarse region. */
  marketRegion?: string;
  provenance?: ProvenancePolicy;
  /** Minimum fresh comparable observations for a usable summary. Default 3. */
  minSampleSize?: number;
  /** Observation ids to leave out (e.g. the user's own current checkout). */
  excludeIds?: readonly string[];
}

export interface GroupStats {
  key: string;
  sampleSize: number;
  lowestCents: Cents;
  medianCents: Cents;
  highestCents: Cents;
}

export interface MarketSummary {
  sufficient: boolean;
  sampleSize: number;
  lowestCents: Cents | null;
  medianCents: Cents | null;
  highestCents: Cents | null;
  spreadCents: Cents | null;
  freshness: {
    freshWithinMinutes: number;
    newestAgeMinutes: number | null;
    oldestAgeMinutes: number | null;
  };
  provenanceMix: Record<ProvenanceClass, number>;
  containsSynthetic: boolean;
  /** Fresh comparable observations grouped by coarse region (all regions). */
  regionalVariation: GroupStats[];
  /** Grouped by membership / promotion scope — observed context, not causation. */
  accountContextVariation: GroupStats[];
  comparable: CartQuoteObservation[];
  excluded: Array<{ id: string; reason: string }>;
}

function allowedByPolicy(observation: MarketObservation, policy: ProvenancePolicy): boolean {
  const synthetic = observation.provenance.synthetic;
  if (policy === "real-only") return !synthetic;
  if (policy === "synthetic-only") return synthetic;
  return true;
}

function groupStats(groups: Map<string, Cents[]>): GroupStats[] {
  return [...groups.entries()]
    .map(([key, totals]) => {
      const sorted = [...totals].sort((a, b) => a - b);
      return {
        key,
        sampleSize: sorted.length,
        lowestCents: sorted[0]!,
        medianCents: medianCents(sorted)!,
        highestCents: sorted[sorted.length - 1]!
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function push(map: Map<string, Cents[]>, key: string, value: Cents) {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

/**
 * Aggregates fresh, comparable cart-level observations. Item-only prices are
 * excluded (they are not what the user pays). Synthetic data is excluded
 * unless the caller opts in, and then it is flagged.
 */
export function summarizeMarket(observations: readonly MarketObservation[], query: MarketQuery): MarketSummary {
  const freshWithinMinutes = query.freshWithinMinutes ?? 60;
  const policy = query.provenance ?? "real-only";
  const minSampleSize = query.minSampleSize ?? 3;
  const exclude = new Set(query.excludeIds ?? []);

  const excluded: MarketSummary["excluded"] = [];
  const freshComparable: Array<{ observation: CartQuoteObservation; age: number }> = [];

  for (const observation of observations) {
    if (exclude.has(observation.id)) continue;
    if (!allowedByPolicy(observation, policy)) {
      excluded.push({ id: observation.id, reason: `provenance policy ${policy}` });
      continue;
    }
    if (observation.kind !== "cart-quote") {
      excluded.push({ id: observation.id, reason: "item-only price; no cart total observed" });
      continue;
    }
    const match = quoteMatchesRequirement(observation.quote, query.requirement, query.quantity);
    if (!match.comparable) {
      excluded.push({ id: observation.id, reason: match.reasons.join("; ") });
      continue;
    }
    const age = ageMinutes(observation.observedAt, query.now);
    if (age > freshWithinMinutes) {
      excluded.push({ id: observation.id, reason: `stale (${Math.round(age)} min old)` });
      continue;
    }
    freshComparable.push({ observation, age });
  }

  const regions = new Map<string, Cents[]>();
  const accountContexts = new Map<string, Cents[]>();
  for (const { observation } of freshComparable) {
    const total = observation.quote.totalCents;
    push(regions, observation.context.marketRegion ?? "unknown", total);
    push(accountContexts, `membership:${observation.context.membership}`, total);
    push(accountContexts, `promotion:${observation.context.promotionScope}`, total);
  }

  const headline = query.marketRegion
    ? freshComparable.filter(({ observation }) => observation.context.marketRegion === query.marketRegion)
    : freshComparable;
  if (query.marketRegion) {
    for (const { observation } of freshComparable) {
      if (observation.context.marketRegion !== query.marketRegion) {
        excluded.push({ id: observation.id, reason: `other region (${observation.context.marketRegion ?? "unknown"})` });
      }
    }
  }

  const totals = headline.map(({ observation }) => observation.quote.totalCents).sort((a, b) => a - b);
  const ages = headline.map(({ age }) => age);
  const provenanceMix: Record<ProvenanceClass, number> = { live: 0, manual: 0, partner: 0, synthetic: 0 };
  for (const { observation } of headline) provenanceMix[provenanceClass(observation.provenance)] += 1;

  const lowest = totals[0] ?? null;
  const highest = totals[totals.length - 1] ?? null;

  return {
    sufficient: totals.length >= minSampleSize,
    sampleSize: totals.length,
    lowestCents: lowest,
    medianCents: medianCents(totals),
    highestCents: highest,
    spreadCents: lowest !== null && highest !== null ? subtractCents(highest, lowest) : null,
    freshness: {
      freshWithinMinutes,
      newestAgeMinutes: ages.length ? Math.round(Math.min(...ages)) : null,
      oldestAgeMinutes: ages.length ? Math.round(Math.max(...ages)) : null
    },
    provenanceMix,
    containsSynthetic: provenanceMix.synthetic > 0,
    regionalVariation: groupStats(regions),
    accountContextVariation: groupStats(accountContexts),
    comparable: headline.map(({ observation }) => observation),
    excluded
  };
}

export type CheckoutPosition = "insufficient-data" | "below-observed-range" | "at-or-below-median" | "above-median" | "above-observed-range";

export interface CheckoutComparison {
  position: CheckoutPosition;
  differenceFromMedianCents: Cents | null;
  message: string;
}

/**
 * Observational comparison of the user's checkout against the market. It
 * describes what was observed; it never claims why prices differ.
 */
export function compareCheckout(currentTotalCents: Cents, summary: MarketSummary): CheckoutComparison {
  const current = `Your checkout is ${formatBRL(currentTotalCents)}.`;
  if (!summary.sufficient || summary.medianCents === null || summary.lowestCents === null || summary.highestCents === null) {
    return {
      position: "insufficient-data",
      differenceFromMedianCents: null,
      message: `${current} Not enough fresh market data (${summary.sampleSize} comparable observation${summary.sampleSize === 1 ? "" : "s"}).`
    };
  }
  const diff = subtractCents(currentTotalCents, summary.medianCents);
  let position: CheckoutPosition;
  if (currentTotalCents < summary.lowestCents) position = "below-observed-range";
  else if (currentTotalCents > summary.highestCents) position = "above-observed-range";
  else if (diff <= 0) position = "at-or-below-median";
  else position = "above-median";

  const parts = [
    current,
    `Comparable observations range from ${formatBRL(summary.lowestCents)} to ${formatBRL(summary.highestCents)}`,
    `(median ${formatBRL(summary.medianCents)}, ${summary.sampleSize} fresh observations).`
  ];
  if (diff > 0) parts.push(`That is ${formatBRL(diff)} above the observed median.`);
  else if (diff < 0) parts.push(`That is ${formatBRL(cents(-diff))} below the observed median.`);
  else parts.push("That equals the observed median.");
  if (summary.containsSynthetic) parts.push("Includes synthetic fixture data.");

  return { position, differenceFromMedianCents: diff, message: parts.join(" ") };
}
