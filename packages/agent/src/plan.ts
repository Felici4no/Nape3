import type { CartQuoteObservation, MarketObservation } from "@nape3/domain";
import { decide, type Decision, type DecisionPolicy } from "./decision";
import { parseIntent, type ParseIntentResult } from "./intent";
import { initialContext, run, type AgentContext } from "./state-machine";

export interface PurchasePlan {
  intent: ParseIntentResult;
  decision: Decision | null;
  agent: AgentContext;
}

/**
 * Runs the deterministic part of the agent: intent → market search →
 * constraints → selection → waiting for user confirmation. It never goes
 * past USER_CONFIRMATION on its own.
 */
export function planPurchase(
  request: string,
  observations: readonly MarketObservation[],
  options: { now: Date; policy?: Partial<DecisionPolicy>; currentCheckout?: CartQuoteObservation }
): PurchasePlan {
  const intent = parseIntent(request);
  if (!intent.ok) {
    const failed = run([{ type: "FAIL", error: intent.reason }], initialContext(), options.now);
    return { intent, decision: null, agent: failed.context };
  }
  const decision = decide(intent.intent, observations, options);
  const normalized = decision.selected ? 1 : 0;
  const result = run(
    [
      { type: "INTENT_CAPTURED", intent: intent.intent },
      { type: "MARKET_SEARCH_STARTED" },
      { type: "CANDIDATES_NORMALIZED", count: decision.rejected.length + decision.alternatives.length + normalized },
      { type: "CONSTRAINTS_APPLIED", validCount: decision.alternatives.length + normalized },
      { type: "OPTION_SELECTED", decision },
      { type: "CONFIRMATION_REQUESTED" }
    ],
    initialContext(),
    options.now
  );
  return { intent, decision, agent: result.context };
}
