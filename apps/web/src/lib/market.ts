import { planPurchase, type Decision, type PurchasePlan } from "@nape3/agent";
import type { MarketObservation, PromotionScope, ProductRequirement } from "@nape3/domain";
import { priceChange, summarizeMarket, type MarketSummary, type PriceChange, type ProvenancePolicy } from "@nape3/market";
import { usdcEstimate } from "./format";
import type { DataMode, MarketSource } from "./source";

/**
 * Data layer of the Food Market. Pure functions over the existing packages:
 * market source → summarizeMarket / priceChange / planPurchase. Nothing here
 * invents numbers; every figure comes from the observations of one source
 * (live or demo, never both), and that source is carried to the UI.
 */

export type ArtKind = "acai" | "burger" | "pizza" | "sushi";

export interface Instrument {
  slug: string;
  /** Normalized food name, as the market trades it. */
  name: string;
  ticker: string;
  unit: string;
  requirement: ProductRequirement;
  art: ArtKind;
  tone: "acai" | "acai-light" | "burger" | "pizza" | "sushi";
  /** Example natural-language intent for the agent. */
  intent: string;
}

export const INSTRUMENTS: Instrument[] = [
  { slug: "acai-500ml", name: "Açaí 500ml", ticker: "ACAI.500", unit: "copo 500 ml", requirement: { category: "acai", volumeMl: 500 }, art: "acai", tone: "acai", intent: "quero um açaí 500ml até R$25" },
  { slug: "burger", name: "Burger", ticker: "BRGR.1", unit: "1 burger, sem acompanhamentos", requirement: { category: "burger" }, art: "burger", tone: "burger", intent: "quero um hambúrguer até R$35" },
  { slug: "pizza-grande", name: "Pizza grande", ticker: "PIZZA.G", unit: "8 fatias", requirement: { category: "pizza", size: "grande" }, art: "pizza", tone: "pizza", intent: "quero uma pizza grande até R$60" },
  { slug: "sushi-20", name: "Sushi 20 peças", ticker: "SUSHI.20", unit: "combinado 20 peças", requirement: { category: "sushi", pieces: 20 }, art: "sushi", tone: "sushi", intent: "combinado 20 peças até R$75" },
  { slug: "acai-300ml", name: "Açaí 300ml", ticker: "ACAI.300", unit: "copo 300 ml", requirement: { category: "acai", volumeMl: 300 }, art: "acai", tone: "acai-light", intent: "quero um açaí 300ml até R$20" }
];

/** Demo region for "near you" (coarse, as the observation network stores it). */
export const REGION = { code: "BR-SP-sao-paulo", label: "São Paulo" } as const;

/** Observations count as fresh for 2 h; movement compares with 24 h earlier. */
export const FRESH_MINUTES = 120;
export const CHANGE_LAG_MINUTES = 24 * 60;

/**
 * Live summaries see real observations only; demo summaries see fixtures only.
 * `include-synthetic` is never used by the website.
 */
export function policyFor(mode: DataMode): ProvenancePolicy {
  return mode === "live" ? "real-only" : "synthetic-only";
}

/** Promotions that depend on who is looking: observed context, not a public price. */
const ACCOUNT_SCOPES: readonly PromotionScope[] = ["account-specific", "first-order", "membership"];

export function isAccountSpecific(observation: MarketObservation): boolean {
  const membership = observation.context.membership;
  return ACCOUNT_SCOPES.includes(observation.context.promotionScope) || (membership !== "none" && membership !== "unknown");
}

export interface ObservationRow {
  id: string;
  source: string;
  merchant: string;
  title: string;
  totalCents: number;
  ageMinutes: number;
  region: string | null;
  promotion: string;
  membership: string;
  /** Price seen under an account-specific context (coupon, first order, membership). */
  accountSpecific: boolean;
  synthetic: boolean;
}

export interface InstrumentQuote {
  instrument: Instrument;
  summary: Pick<
    MarketSummary,
    "sufficient" | "sampleSize" | "lowestCents" | "medianCents" | "highestCents" | "spreadCents" | "freshness" | "containsSynthetic" | "regionalVariation" | "accountContextVariation"
  >;
  change: PriceChange | null;
  observations: ObservationRow[];
  excludedCount: number;
  usdc: { median: string | null; lowest: string | null };
  /** Comparable observations in the region that are too old to quote, and the newest of them. */
  stale: { count: number; newestAgeMinutes: number | null };
  /** Fresh comparable observations in other regions (not in the headline). */
  otherRegions: number;
  /** The lowest observed total was seen under an account-specific context. */
  lowestIsAccountSpecific: boolean;
}

export function quoteInstrument(observations: readonly MarketObservation[], instrument: Instrument, now: Date, mode: DataMode): InstrumentQuote {
  const query = {
    requirement: instrument.requirement,
    quantity: 1,
    now,
    freshWithinMinutes: FRESH_MINUTES,
    provenance: policyFor(mode),
    marketRegion: REGION.code
  };
  const summary = summarizeMarket(observations, query);
  // Same filter over the whole fetched window: tells "quiet" apart from "stale".
  const window = summarizeMarket(observations, { ...query, freshWithinMinutes: Number.MAX_SAFE_INTEGER, minSampleSize: 1 });
  const freshIds = new Set(summary.comparable.map((o) => o.id));
  const staleAges = window.comparable
    .filter((o) => !freshIds.has(o.id))
    .map((o) => Math.round((now.getTime() - Date.parse(o.observedAt)) / 60_000));
  const otherRegions = summary.regionalVariation.filter((g) => g.key !== REGION.code).reduce((n, g) => n + g.sampleSize, 0);
  const change = priceChange(observations, query, { lagMinutes: CHANGE_LAG_MINUTES });
  const rows: ObservationRow[] = summary.comparable
    .map((o) => ({
      id: o.id,
      source: o.source,
      merchant: o.quote.merchant.name,
      title: o.quote.lines.map((l) => `${l.quantity}× ${l.sourceTitle}`).join(" + "),
      totalCents: o.quote.totalCents,
      ageMinutes: Math.round((now.getTime() - Date.parse(o.observedAt)) / 60_000),
      region: o.context.marketRegion ?? null,
      promotion: o.context.promotionScope,
      membership: o.context.membership,
      accountSpecific: isAccountSpecific(o),
      synthetic: o.provenance.synthetic
    }))
    .sort((a, b) => a.totalCents - b.totalCents);
  return {
    instrument,
    summary: {
      sufficient: summary.sufficient,
      sampleSize: summary.sampleSize,
      lowestCents: summary.lowestCents,
      medianCents: summary.medianCents,
      highestCents: summary.highestCents,
      spreadCents: summary.spreadCents,
      freshness: summary.freshness,
      containsSynthetic: summary.containsSynthetic,
      regionalVariation: summary.regionalVariation,
      accountContextVariation: summary.accountContextVariation
    },
    change,
    observations: rows,
    excludedCount: summary.excluded.length,
    usdc: {
      median: summary.medianCents === null ? null : usdcEstimate(summary.medianCents),
      lowest: summary.lowestCents === null ? null : usdcEstimate(summary.lowestCents)
    },
    stale: { count: staleAges.length, newestAgeMinutes: staleAges.length ? Math.min(...staleAges) : null },
    otherRegions,
    lowestIsAccountSpecific: rows.length > 0 && rows[0]!.accountSpecific
  };
}

export function quoteAll(source: MarketSource, now: Date): InstrumentQuote[] {
  return INSTRUMENTS.map((instrument) => quoteInstrument(source.observations, instrument, now, source.mode));
}

export function findInstrument(slug: string): Instrument | undefined {
  return INSTRUMENTS.find((i) => i.slug === slug);
}

export interface AgentPick {
  instrument: Instrument;
  intent: string;
  decision: Decision | null;
  error: string | null;
}

/** The agent over one market source: same engine as the extension, same policy as the quotes. */
export function planIntent(source: MarketSource, request: string, now: Date): PurchasePlan {
  return planPurchase(request.slice(0, 200), source.observations, {
    now,
    // Same freshness horizon as the board: nothing the market calls stale can be the agent's pick.
    policy: { provenance: policyFor(source.mode), marketRegion: REGION.code, staleAfterMinutes: 60, rejectAfterMinutes: FRESH_MINUTES }
  });
}

/** The agent's answer for each instrument's example intent (same engine as /agent). */
export function agentPicks(source: MarketSource, now: Date): AgentPick[] {
  return INSTRUMENTS.slice(0, 4).map((instrument) => {
    const plan = planIntent(source, instrument.intent, now);
    return { instrument, intent: instrument.intent, decision: plan.decision, error: plan.intent.ok ? null : plan.intent.reason };
  });
}

export { brl, changeLabel, freshnessLabel, usdcEstimate, USDC_RATE } from "./format";
