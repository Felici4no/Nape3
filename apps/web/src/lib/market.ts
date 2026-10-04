import { planPurchase, type Decision } from "@nape3/agent";
import type { MarketObservation, ProductRequirement } from "@nape3/domain";
import { marketFixtures } from "@nape3/fixtures";
import { priceChange, summarizeMarket, type MarketSummary, type PriceChange } from "@nape3/market";
import { usdcEstimate } from "./format";

/**
 * Data layer of the Food Market. Pure functions over the existing packages:
 * fixtures → summarizeMarket / priceChange / planPurchase. Nothing here
 * invents numbers; every figure comes from observations, and the source of
 * those observations is carried to the UI (`DATA_SOURCE`).
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

export const DATA_SOURCE = {
  synthetic: true,
  label: "Synthetic demo data",
  detail:
    "Prices on this site come from deterministic fixtures with fictitious merchants, not from real iFood, Rappi or 99Food observations. " +
    "Real observations come from the UPAY3FOOD.agent extension and the observer API."
} as const;

/** Demo region for "near you" (coarse, as the observation network stores it). */
export const REGION = { code: "BR-SP-sao-paulo", label: "São Paulo" } as const;

/** Observations count as fresh for 2 h; movement compares with 24 h earlier. */
export const FRESH_MINUTES = 120;
export const CHANGE_LAG_MINUTES = 24 * 60;

export function loadObservations(now: Date): MarketObservation[] {
  return marketFixtures(now);
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
}

export function quoteInstrument(observations: readonly MarketObservation[], instrument: Instrument, now: Date): InstrumentQuote {
  const query = {
    requirement: instrument.requirement,
    quantity: 1,
    now,
    freshWithinMinutes: FRESH_MINUTES,
    provenance: "include-synthetic" as const,
    marketRegion: REGION.code
  };
  const summary = summarizeMarket(observations, query);
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
    }
  };
}

export function quoteAll(now: Date): InstrumentQuote[] {
  const observations = loadObservations(now);
  return INSTRUMENTS.map((instrument) => quoteInstrument(observations, instrument, now));
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

/** The agent's answer for each instrument's example intent (same engine as /agent). */
export function agentPicks(now: Date): AgentPick[] {
  const observations = loadObservations(now);
  return INSTRUMENTS.slice(0, 4).map((instrument) => {
    const plan = planPurchase(instrument.intent, observations, {
      now,
      policy: { provenance: "include-synthetic", marketRegion: REGION.code }
    });
    return { instrument, intent: instrument.intent, decision: plan.decision, error: plan.intent.ok ? null : plan.intent.reason };
  });
}




export { brl, changeLabel, freshnessLabel, usdcEstimate, USDC_RATE } from "./format";
