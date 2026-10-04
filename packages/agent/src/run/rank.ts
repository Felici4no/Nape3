import type { MarketObservation, ProductRequirement, PurchaseIntent } from "@nape3/domain";
import type { ProvenancePolicy } from "@nape3/market";
import { decide } from "../decision";
import type { CandidateRef, RunPolicy } from "./types";
import { DEFAULT_RUN_POLICY } from "./types";

/** The product a run buys, exactly as the intent states it (no inference from carts). */
export function intentRequirement(intent: PurchaseIntent): ProductRequirement {
  const { category, volumeMl, size, pieces } = intent.product;
  return { category, ...(volumeMl !== undefined ? { volumeMl } : {}), ...(size ? { size } : {}), ...(pieces !== undefined ? { pieces } : {}) };
}

const ACCOUNT_SCOPES = ["account-specific", "first-order", "membership"];

/**
 * Market search → ranked candidates, using the existing decision engine
 * (hard constraints, then the explainable score). Stale observations are
 * rejected by the engine (`rejectAfterMinutes`), so they never become
 * candidates. Every candidate is a market reference: it still has to be
 * revalidated in the user's session.
 */
export function rankCandidates(
  intent: PurchaseIntent,
  observations: readonly MarketObservation[],
  options: { now: Date; provenance: ProvenancePolicy; marketRegion?: string; policy?: RunPolicy }
): { candidates: CandidateRef[]; rejectedCount: number } {
  const policy = options.policy ?? DEFAULT_RUN_POLICY;
  const decision = decide(intent, observations, {
    now: options.now,
    policy: {
      provenance: options.provenance,
      rejectAfterMinutes: policy.maxObservationAgeMinutes,
      staleAfterMinutes: Math.min(60, policy.maxObservationAgeMinutes),
      ...(options.marketRegion ? { marketRegion: options.marketRegion } : {})
    }
  });
  const byId = new Map(observations.map((o) => [o.id, o]));
  const accepted = decision.selected ? [decision.selected, ...decision.alternatives] : [];
  const candidates = accepted
    .filter((c) => c.totalCents !== null)
    .slice(0, policy.maxCandidates)
    .map((c, index): CandidateRef => {
      const observation = byId.get(c.observationId);
      return {
        candidateId: c.observationId,
        source: c.source,
        merchantName: c.merchantName,
        observedTotalCents: c.totalCents!,
        observedAt: observation?.observedAt ?? new Date(options.now.getTime() - c.ageMinutes * 60_000).toISOString(),
        ageMinutes: Math.round(c.ageMinutes),
        provenance: c.provenance,
        accountSpecific: observation ? ACCOUNT_SCOPES.includes(observation.context.promotionScope) : false,
        score: c.score?.total ?? 0,
        rank: index + 1
      };
    });
  return { candidates, rejectedCount: decision.rejected.length };
}
