import {
  ageMinutes,
  cents,
  formatBRL,
  medianCents,
  provenanceClass,
  provenanceLabel,
  quoteMatchesRequirement,
  subtractCents,
  verifyCartQuote,
  type Cents,
  type CartQuoteObservation,
  type MarketObservation,
  type ProductRequirement,
  type ProvenanceClass,
  type PurchaseIntent,
  type SourcePlatform
} from "@nape3/domain";
import type { ProvenancePolicy } from "@nape3/market";

/**
 * Explainable decision engine: hard constraints first, then a transparent
 * weighted score. No opaque "AI recommendation": every number in the output
 * can be traced back to an observation and a formula.
 */

export interface DecisionPolicy {
  /** Older than this → confidence is reduced. Default 60 min. */
  staleAfterMinutes: number;
  /** Older than this → rejected. Default 24 h. */
  rejectAfterMinutes: number;
  provenance: ProvenancePolicy;
  /** Random id of this extension install, to recognise our own observations. */
  observerId?: string;
  minNormalizationConfidence: number;
  /** When set, observations from other coarse regions are rejected. */
  marketRegion?: string;
}

export const DEFAULT_POLICY: DecisionPolicy = {
  staleAfterMinutes: 60,
  rejectAfterMinutes: 24 * 60,
  provenance: "real-only",
  minNormalizationConfidence: 0.5
};

/**
 * Who can act on a candidate. Only the user's *current* checkout is something
 * they can continue right now. An observation from another account/install is
 * market intelligence: the same offer may not exist for this account.
 */
export type Executability =
  | { kind: "current-checkout"; executable: true; note: string }
  | { kind: "own-observation"; executable: false; note: string }
  | { kind: "market-reference"; executable: false; note: string };

export interface ScoreBreakdown {
  total: number;
  priceScore: number;
  etaScore: number;
  priceWeight: number;
  etaWeight: number;
  formula: string;
}

export interface CandidateEvaluation {
  observationId: string;
  source: SourcePlatform;
  merchantName: string;
  totalCents: Cents | null;
  etaMidpointMinutes: number | null;
  ageMinutes: number;
  provenance: ProvenanceClass;
  provenanceLabel: string;
  accepted: boolean;
  rejections: string[];
  warnings: string[];
  confidence: number;
  score: ScoreBreakdown | null;
  executability: Executability;
}

export interface Decision {
  status: "selected" | "no-valid-option";
  selected: CandidateEvaluation | null;
  /** Best candidate the user can actually act on (their current checkout). */
  bestExecutable: CandidateEvaluation | null;
  alternatives: CandidateEvaluation[];
  rejected: CandidateEvaluation[];
  totalCents: Cents | null;
  marketMedianCents: Cents | null;
  savings: {
    vsMarketMedianCents: Cents | null;
    vsCurrentCheckoutCents: Cents | null;
    vsMostExpensiveValidCents: Cents | null;
  };
  confidence: number;
  freshness: {
    selectedAgeMinutes: number | null;
    newestAgeMinutes: number | null;
    oldestAgeMinutes: number | null;
  };
  containsSynthetic: boolean;
  reasoning: string[];
}

export interface DecideOptions {
  now: Date;
  policy?: Partial<DecisionPolicy>;
  /** The quote the user is looking at right now, if any. */
  currentCheckout?: CartQuoteObservation;
}

const PROVENANCE_FACTOR: Record<ProvenanceClass, number> = {
  live: 1,
  partner: 0.95,
  manual: 0.85,
  synthetic: 0.5
};

function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function allowed(observation: MarketObservation, policy: ProvenancePolicy): boolean {
  if (policy === "real-only") return !observation.provenance.synthetic;
  if (policy === "synthetic-only") return observation.provenance.synthetic;
  return true;
}

function executabilityOf(
  observation: MarketObservation,
  policy: DecisionPolicy,
  currentId: string | undefined
): Executability {
  if (observation.id === currentId) {
    return {
      kind: "current-checkout",
      executable: true,
      note: "This is your current checkout; you can continue it after confirming."
    };
  }
  if (policy.observerId && observation.observerId === policy.observerId && !observation.provenance.synthetic) {
    return {
      kind: "own-observation",
      executable: false,
      note: `Observed earlier in your own browser on ${observation.source}. Prices change; reopen and verify before paying.`
    };
  }
  return {
    kind: "market-reference",
    executable: false,
    note: `Market reference (${provenanceLabel(observation.provenance)}). The same price may not be available to your account; verify in ${observation.source}.`
  };
}

function etaMidpoint(observation: CartQuoteObservation): number | null {
  const eta = observation.quote.fulfillment?.etaMinutes ?? observation.context.etaMinutes;
  return eta ? (eta.min + eta.max) / 2 : null;
}

function normalizationConfidence(observation: CartQuoteObservation): number {
  return Math.min(...observation.quote.lines.map((line) => line.product?.normalization.confidence ?? 0));
}

export function decide(intent: PurchaseIntent, observations: readonly MarketObservation[], options: DecideOptions): Decision {
  const policy: DecisionPolicy = { ...DEFAULT_POLICY, ...options.policy };
  const requirement: ProductRequirement = { category: intent.product.category };
  const preamble: string[] = [];
  if (intent.product.volumeMl !== undefined) {
    requirement.volumeMl = intent.product.volumeMl;
  } else {
    // Different sizes are not equivalent offers. Without a stated volume we use
    // the size in the user's current cart, and say so; otherwise we warn.
    const cartVolumes = new Set(options.currentCheckout?.quote.lines.map((line) => line.product?.volumeMl));
    const [cartVolume] = [...cartVolumes];
    if (cartVolumes.size === 1 && cartVolume !== undefined) {
      requirement.volumeMl = cartVolume;
      preamble.push(`Volume not stated; using ${cartVolume} ml from your current cart.`);
    } else {
      preamble.push("Volume not stated: candidates of different sizes are being compared. State a volume (e.g. 500ml) for an equivalent comparison.");
    }
  }

  // Quantity: same rule as volume — an unstated quantity follows the current cart.
  let quantity = intent.product.quantity;
  if (intent.parsing.missing.includes("product.quantity") && options.currentCheckout) {
    const cartQuantity = options.currentCheckout.quote.lines.reduce((sum, line) => sum + line.quantity, 0);
    if (cartQuantity > 0 && cartQuantity !== quantity) {
      quantity = cartQuantity;
      preamble.push(`Quantity not stated; using ${cartQuantity} from your current cart.`);
    }
  }

  const all = options.currentCheckout && !observations.some((o) => o.id === options.currentCheckout!.id)
    ? [options.currentCheckout, ...observations]
    : [...observations];
  const currentId = options.currentCheckout?.id;

  const evaluations: CandidateEvaluation[] = [];
  /** Comparable & not too old — used for the market median (ignores budget). */
  const marketTotals: Cents[] = [];

  for (const observation of all) {
    const age = ageMinutes(observation.observedAt, options.now);
    const evaluation: CandidateEvaluation = {
      observationId: observation.id,
      source: observation.source,
      merchantName: observation.kind === "cart-quote" ? observation.quote.merchant.name : observation.offer.merchant.name,
      totalCents: observation.kind === "cart-quote" ? observation.quote.totalCents : null,
      etaMidpointMinutes: observation.kind === "cart-quote" ? etaMidpoint(observation) : null,
      ageMinutes: Math.round(age),
      provenance: provenanceClass(observation.provenance),
      provenanceLabel: provenanceLabel(observation.provenance),
      accepted: false,
      rejections: [],
      warnings: [],
      confidence: 0,
      score: null,
      executability: executabilityOf(observation, policy, currentId)
    };
    evaluations.push(evaluation);

    // ---- hard constraints -------------------------------------------------
    if (!allowed(observation, policy.provenance) && observation.id !== currentId) {
      evaluation.rejections.push(`excluded by provenance policy "${policy.provenance}"`);
      continue;
    }
    if (observation.kind !== "cart-quote") {
      evaluation.rejections.push("item-only price; no cart total observed (ranking requires CartQuote.totalCents)");
      continue;
    }
    const comparable = quoteMatchesRequirement(observation.quote, requirement, quantity);
    if (!comparable.comparable) {
      evaluation.rejections.push(...comparable.reasons);
      continue;
    }
    if (policy.marketRegion && observation.context.marketRegion !== policy.marketRegion && observation.id !== currentId) {
      evaluation.rejections.push(`other region (${observation.context.marketRegion ?? "unknown"})`);
      continue;
    }
    const normConfidence = normalizationConfidence(observation);
    if (normConfidence < policy.minNormalizationConfidence) {
      evaluation.rejections.push(`normalization confidence ${normConfidence} below ${policy.minNormalizationConfidence}`);
      continue;
    }
    if (age > policy.rejectAfterMinutes) {
      evaluation.rejections.push(`stale: observed ${Math.round(age)} min ago (limit ${policy.rejectAfterMinutes})`);
      continue;
    }
    marketTotals.push(observation.quote.totalCents);

    const max = intent.budget.maxCents;
    if (max !== undefined && observation.quote.totalCents > max) {
      evaluation.rejections.push(
        `total ${formatBRL(observation.quote.totalCents)} exceeds max budget ${formatBRL(max)}`
      );
      continue;
    }

    // ---- soft factors → confidence ---------------------------------------
    let freshnessFactor = 1;
    if (age > policy.staleAfterMinutes) {
      const span = policy.rejectAfterMinutes - policy.staleAfterMinutes;
      freshnessFactor = 1 - 0.5 * Math.min(1, (age - policy.staleAfterMinutes) / span);
      evaluation.warnings.push(`older than ${policy.staleAfterMinutes} min; confidence reduced`);
    }
    const consistency = verifyCartQuote(observation.quote);
    if (!consistency.consistent) evaluation.warnings.push(...consistency.issues);
    if (evaluation.etaMidpointMinutes === null) evaluation.warnings.push("ETA unknown; neutral ETA score used");
    if (observation.provenance.synthetic) evaluation.warnings.push("synthetic fixture data");

    evaluation.confidence = round(
      normConfidence * freshnessFactor * PROVENANCE_FACTOR[evaluation.provenance] * (consistency.consistent ? 1 : 0.7)
    );
    evaluation.accepted = true;
  }

  // ---- ranking ------------------------------------------------------------
  const accepted = evaluations.filter((e) => e.accepted);
  const weightSum = intent.preferences.priceWeight + intent.preferences.etaWeight || 1;
  const priceWeight = intent.preferences.priceWeight / weightSum;
  const etaWeight = intent.preferences.etaWeight / weightSum;
  const totals = accepted.map((e) => e.totalCents!);
  const etas = accepted.map((e) => e.etaMidpointMinutes).filter((v): v is number => v !== null);
  const [minT, maxT] = [Math.min(...totals), Math.max(...totals)];
  const [minE, maxE] = [Math.min(...etas), Math.max(...etas)];

  for (const e of accepted) {
    const priceScore = maxT === minT ? 1 : (maxT - e.totalCents!) / (maxT - minT);
    const etaScore =
      e.etaMidpointMinutes === null ? 0.5 : maxE === minE ? 1 : (maxE - e.etaMidpointMinutes) / (maxE - minE);
    const total = priceWeight * priceScore + etaWeight * etaScore;
    e.score = {
      total: round(total, 3),
      priceScore: round(priceScore, 3),
      etaScore: round(etaScore, 3),
      priceWeight: round(priceWeight, 3),
      etaWeight: round(etaWeight, 3),
      formula: `${round(priceWeight, 2)}×price ${round(priceScore, 2)} + ${round(etaWeight, 2)}×eta ${round(etaScore, 2)} = ${round(total, 3)}`
    };
  }
  accepted.sort(
    (a, b) =>
      b.score!.total - a.score!.total ||
      a.totalCents! - b.totalCents! ||
      a.ageMinutes - b.ageMinutes ||
      a.observationId.localeCompare(b.observationId)
  );

  const selected = accepted[0] ?? null;
  const bestExecutable = accepted.find((e) => e.executability.executable) ?? null;
  const rejected = evaluations.filter((e) => !e.accepted);
  const marketMedian = medianCents(marketTotals);
  // Savings vs the user's checkout only make sense if that checkout is comparable.
  const currentComparable =
    options.currentCheckout !== undefined &&
    quoteMatchesRequirement(options.currentCheckout.quote, requirement, quantity).comparable;
  const currentTotal = currentComparable ? options.currentCheckout!.quote.totalCents : null;
  const containsSynthetic = accepted.some((e) => e.provenance === "synthetic");

  const reasoning: string[] = [
    ...preamble,
    `Intent: ${quantity}× ${intent.product.category}` +
      (requirement.volumeMl ? ` ${requirement.volumeMl} ml` : "") +
      (intent.budget.maxCents !== undefined ? `, max ${formatBRL(intent.budget.maxCents)}` : ", no max budget"),
    `Evaluated ${evaluations.length} observation(s); ${accepted.length} passed hard constraints, ${rejected.length} rejected.`
  ];
  for (const r of rejected) reasoning.push(`Rejected ${r.source} · ${r.merchantName}: ${r.rejections.join("; ")}`);

  if (!selected) {
    reasoning.push("No valid option. Nothing is recommended.");
    return {
      status: "no-valid-option",
      selected: null,
      bestExecutable: null,
      alternatives: [],
      rejected,
      totalCents: null,
      marketMedianCents: marketMedian,
      savings: { vsMarketMedianCents: null, vsCurrentCheckoutCents: null, vsMostExpensiveValidCents: null },
      confidence: 0,
      freshness: { selectedAgeMinutes: null, newestAgeMinutes: null, oldestAgeMinutes: null },
      containsSynthetic,
      reasoning
    };
  }

  const total = selected.totalCents!;
  reasoning.push(
    `Selected ${selected.source} · ${selected.merchantName}: total ${formatBRL(total)} (score ${selected.score!.formula}).`
  );
  if (marketMedian !== null) {
    const diff = subtractCents(marketMedian, total);
    reasoning.push(
      diff >= 0
        ? `${formatBRL(diff)} below the comparable market median ${formatBRL(marketMedian)}.`
        : `${formatBRL(cents(-diff))} above the comparable market median ${formatBRL(marketMedian)}.`
    );
  }
  reasoning.push(selected.executability.note);
  if (!selected.executability.executable && bestExecutable) {
    reasoning.push(`Best option you can act on now: your current checkout at ${formatBRL(bestExecutable.totalCents!)}.`);
  }
  if (containsSynthetic) reasoning.push("Includes synthetic fixture data — not real market prices.");

  const ages = accepted.map((e) => e.ageMinutes);
  return {
    status: "selected",
    selected,
    bestExecutable,
    alternatives: accepted.slice(1),
    rejected,
    totalCents: total,
    marketMedianCents: marketMedian,
    savings: {
      vsMarketMedianCents: marketMedian !== null ? subtractCents(marketMedian, total) : null,
      vsCurrentCheckoutCents: currentTotal !== null ? subtractCents(currentTotal, total) : null,
      vsMostExpensiveValidCents: subtractCents(cents(maxT), total)
    },
    confidence: selected.confidence,
    freshness: {
      selectedAgeMinutes: selected.ageMinutes,
      newestAgeMinutes: Math.min(...ages),
      oldestAgeMinutes: Math.max(...ages)
    },
    containsSynthetic,
    reasoning
  };
}
