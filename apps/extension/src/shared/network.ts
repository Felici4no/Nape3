import type { MarketObservation } from "@nape3/domain";
import { sanitizeObservation } from "@nape3/market";

/**
 * Observations read back from the observer network. Every item is
 * re-sanitized (allowlist) and anything synthetic is dropped: the network
 * is real data only. This browser's own observations win on id collisions
 * (they may carry this install's observer id, which the network strips).
 */
export function mergeNetworkObservations(own: readonly MarketObservation[], remote: unknown): { observations: MarketObservation[]; dropped: number } {
  const ids = new Set(own.map((o) => o.id));
  const merged = [...own];
  let dropped = 0;
  for (const item of Array.isArray(remote) ? remote : []) {
    const result = sanitizeObservation(item);
    if (!result.ok || result.observation.provenance.synthetic) {
      dropped += 1;
      continue;
    }
    if (ids.has(result.observation.id)) continue;
    ids.add(result.observation.id);
    merged.push(result.observation);
  }
  return { observations: merged, dropped };
}
