import type { AgentRun, PixTarget } from "@nape3/agent";
import type { FundingRequirement } from "@nape3/agent";
import type { SolanaRpcProvider } from "@nape3/chain";
import type { Cents, MarketObservation } from "@nape3/domain";

/**
 * What the orchestrator needs from the outside world. Interfaces only: the
 * agent never sees Cloak SDK internals, RPC URLs, wallet providers or the
 * browser. Real and mock adapters live in ./adapters.
 */

export interface MarketSearch {
  observations: MarketObservation[];
  /** live = real observations only; demo = synthetic fixtures only. Never mixed. */
  mode: "live" | "demo";
  marketRegion?: string;
}

export interface MarketPort {
  search(now: Date): Promise<MarketSearch>;
}

export interface FundingPort {
  /** True while no licensed off-ramp is integrated. */
  readonly simulated: boolean;
  /** USDC the off-ramp needs for this Pix, plus the Cloak withdraw fee. */
  requirement(amountCents: Cents, pix: PixTarget, now: Date): Promise<FundingRequirement>;
}

export type SettlementCheck =
  | { status: "settled"; reference: string; simulated: boolean }
  | { status: "pending" }
  | { status: "failed"; reason: string };

export interface SettlementPort {
  verify(run: AgentRun, signature: string, now: Date): Promise<SettlementCheck>;
}

export interface ChainPort {
  provider: SolanaRpcProvider;
  usdcMint: string;
}
