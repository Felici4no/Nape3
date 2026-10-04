import type { Cents, ProductRequirement, PurchaseIntent } from "@nape3/domain";
import type { PaymentDestinationType } from "../funding";
import type { AgentBrowserCommand } from "./protocol";
import type { AuthorizationBasis, CandidateRef, ExecutionMode, ExecutorQuote, PixTarget } from "./types";

/**
 * Append-only run events. Payloads are JSON-safe: USDC amounts and lamports
 * are decimal strings (bigint on the wire would not survive JSON / jsonb).
 */

export type Actor = "user" | "agent" | "browser" | "wallet" | "chain" | "system";

/** Decimal string of a non-negative bigint. */
export type BigintString = string;

export interface WireFunds {
  address: string;
  publicUsdc: BigintString;
  shieldedUsdc: BigintString;
  solLamports: BigintString;
  checkedAt: string;
}

export interface WireRequirement {
  checkoutTotalCents: Cents;
  offrampNetUsdc: BigintString;
  cloakFeeUsdc: BigintString;
  grossUsdc: BigintString;
  destination: PaymentDestinationType;
  quoteSimulated: boolean;
}

export interface WireFundingPolicy {
  minShieldUsdc: BigintString;
  minSolForShieldLamports: BigintString;
}

export interface WireConfirmationRequest {
  amountCents: Cents;
  grossUsdc: BigintString;
  walletAddress: string;
  candidateId: string;
  checkoutCapturedAt: string;
  expiresAt: string;
  digest: string;
}

export type RunEventBody =
  | {
      type: "INTENT_CREATED";
      payload: { intent: PurchaseIntent; requirement: ProductRequirement; executorId: string; executionMode: ExecutionMode; userId?: string };
    }
  | { type: "MARKET_SEARCH_STARTED"; payload: Record<string, never> }
  | {
      type: "MARKET_SEARCHED";
      payload: { candidates: CandidateRef[]; rejectedCount: number; observationCount: number; sourceMode: "live" | "demo" };
    }
  | { type: "CANDIDATE_SELECTED"; payload: { candidateId: string } }
  | { type: "REVALIDATION_REQUESTED"; payload: { command: AgentBrowserCommand } }
  | { type: "REVALIDATION_STARTED"; payload: { commandId: string } }
  | { type: "QUOTE_VALIDATED"; payload: { quote: ExecutorQuote } }
  | { type: "CANDIDATE_REJECTED"; payload: { candidateId: string; reasons: string[] } }
  | { type: "CHECKOUT_REQUESTED"; payload: { command: AgentBrowserCommand } }
  | { type: "CHECKOUT_READY"; payload: { quote: ExecutorQuote } }
  /** The checkout must be read again (quote went stale, wallet changed). Pix and confirmation are dropped. */
  | { type: "CHECKOUT_INVALIDATED"; payload: { reason: string } }
  | { type: "PIX_REQUESTED"; payload: { command: AgentBrowserCommand } }
  | { type: "PIX_DETECTED"; payload: { pix: PixTarget } }
  | { type: "BROWSER_NEEDS_USER"; payload: { commandId: string; reason: string } }
  | { type: "WALLET_CONNECTED"; payload: { address: string; shieldedUsdc?: BigintString; reportedAt?: string } }
  | { type: "WALLET_DISCONNECTED"; payload: Record<string, never> }
  /** Pix is known and no wallet is connected yet. */
  | { type: "WALLET_REQUIRED"; payload: Record<string, never> }
  | { type: "FUNDS_CHECKED"; payload: { funds: WireFunds; requirement: WireRequirement; verified: boolean; policy?: WireFundingPolicy } }
  | { type: "SHIELD_REQUIRED"; payload: Record<string, never> }
  | { type: "PAYMENT_READY"; payload: Record<string, never> }
  | { type: "CONFIRMATION_REQUESTED"; payload: { request: WireConfirmationRequest } }
  | { type: "USER_CONFIRMED"; payload: { digest: string; amountCents: Cents } }
  | { type: "USER_REJECTED"; payload: { reason?: string } }
  | { type: "PAYMENT_AUTHORIZED"; payload: { amountCents: Cents; basis: AuthorizationBasis } }
  | { type: "PAYMENT_SUBMITTED"; payload: { signature: string } }
  | { type: "SETTLEMENT_VERIFIED"; payload: { signature: string; reference: string; simulated: boolean } }
  | { type: "SETTLEMENT_FAILED"; payload: { reason: string } }
  | { type: "ORDER_REQUESTED"; payload: { command: AgentBrowserCommand } }
  | { type: "ORDER_CONFIRMED"; payload: { evidence: string } }
  | { type: "RUN_FAILED"; payload: { code: string; reason: string } };

export type RunEventType = RunEventBody["type"];

export interface EventMeta {
  runId: string;
  /** 1-based, gap-free per run. */
  seq: number;
  at: string;
  actor: Actor;
}

export type RunEvent = RunEventBody & EventMeta;

/** Builds an event body with type checking on the payload. */
export function eventBody<T extends RunEventType>(type: T, payload: Extract<RunEventBody, { type: T }>["payload"]): Extract<RunEventBody, { type: T }> {
  return { type, payload } as Extract<RunEventBody, { type: T }>;
}
