import type { Cents, CartQuote, ProductRequirement, ProvenanceClass, PurchaseIntent, SourcePlatform } from "@nape3/domain";
import type { FundingAssessment, FundingRequirement, WalletFunds } from "../funding";
import type { AgentBrowserCommand } from "./protocol";

/**
 * Persistent purchase run. Everything here is derived from the run's
 * append-only event log by `reduceRun`; nothing is mutated in place.
 */

export type RunState =
  | "INTENT_CAPTURED"
  | "MARKET_SEARCH"
  | "CANDIDATES_NORMALIZED"
  | "BEST_OPTION_SELECTED"
  | "REVALIDATION_REQUESTED"
  | "REVALIDATING"
  | "QUOTE_VALIDATED"
  | "CHECKOUT_PREPARED"
  | "PIX_DETECTED"
  | "WALLET_REQUIRED"
  | "WALLET_CONNECTED"
  | "FUNDS_CHECKED"
  | "SHIELD_REQUIRED"
  | "PAYMENT_READY"
  | "USER_CONFIRMATION"
  | "PAYMENT_AUTHORIZED"
  | "SETTLING"
  | "SETTLED"
  | "ORDER_CONFIRMED"
  // failure / fallback
  | "NO_VALID_OPTION"
  | "CANCELLED"
  | "SETTLEMENT_FAILED"
  | "FAILED";

export const TERMINAL_STATES: readonly RunState[] = ["ORDER_CONFIRMED", "NO_VALID_OPTION", "CANCELLED", "SETTLEMENT_FAILED", "FAILED"];

/** States where the wallet/funding path is active (a wallet change resets it). */
export const FUNDING_STATES: readonly RunState[] = [
  "PIX_DETECTED",
  "WALLET_REQUIRED",
  "WALLET_CONNECTED",
  "FUNDS_CHECKED",
  "SHIELD_REQUIRED",
  "PAYMENT_READY",
  "USER_CONFIRMATION"
];

/** "simulated": no real money moves (mock off-ramp). "real" requires a licensed off-ramp. */
export type ExecutionMode = "simulated" | "real";

/**
 * A market observation the agent may try. A reference only: nothing about it
 * is executable until the user's own browser session re-reads it.
 */
export interface CandidateRef {
  candidateId: string;
  source: SourcePlatform;
  merchantName: string;
  observedTotalCents: Cents;
  observedAt: string;
  ageMinutes: number;
  provenance: ProvenanceClass;
  /** Seen under an account-specific promotion/membership. */
  accountSpecific: boolean;
  score: number;
  rank: number;
}

/** A cart quote read in the user's session by the run's browser executor. */
export interface ExecutorQuote {
  quote: CartQuote;
  capturedAt: string;
  executorId: string;
  commandId: string;
  /** Page kind only ("ifood:checkout"); never a URL. */
  pageRef: string;
}

export type PixEvidence = "pix-copy-paste" | "qr-code" | "pix-key" | "pix-selected";

export interface PixTarget {
  amountCents: Cents;
  evidence: PixEvidence;
  expiresAt?: string;
  /** SHA-256 hex of the copy-paste payload, when one is visible. The payload itself is not stored. */
  payloadDigest?: string;
  detectedAt: string;
}

export interface CheckoutState {
  quote: ExecutorQuote;
  pix?: PixTarget;
}

/** Last balances the wallet reported (shielded balance is client-reported: no viewing key server-side). */
export interface WalletReport {
  address: string;
  shieldedUsdc: bigint;
  at: string;
}

export interface ConfirmationRequest {
  amountCents: Cents;
  grossUsdc: bigint;
  walletAddress: string;
  candidateId: string;
  checkoutCapturedAt: string;
  expiresAt: string;
  /** Canonical string of the terms; the user's confirmation must echo it. */
  digest: string;
}

export type AuthorizationBasis = { kind: "user-confirmation" } | { kind: "mandate"; mandateId: string };

export interface PaymentState {
  walletAddress?: string;
  /** Last wallet seen in this run, kept across a disconnect so a different wallet is detected on reconnect. */
  lastWalletAddress?: string;
  walletReport?: WalletReport;
  funds?: WalletFunds;
  /** Whether public balances were read from chain by the runtime (true) or reported by the client. */
  fundsVerified?: boolean;
  requirement?: FundingRequirement;
  assessment?: FundingAssessment;
  confirmationRequest?: ConfirmationRequest;
  confirmation?: { digest: string; amountCents: Cents; at: string };
  authorization?: { amountCents: Cents; basis: AuthorizationBasis; at: string };
  signature?: string;
  settlementReference?: string;
  settlementFailure?: string;
}

export interface AgentRun {
  id: string;
  userId?: string;
  executorId: string;
  executionMode: ExecutionMode;
  state: RunState;
  intent: PurchaseIntent;
  requirement: ProductRequirement;
  candidates: CandidateRef[];
  rejectedCandidates: Array<{ candidateId: string; reasons: string[] }>;
  selectedCandidate?: CandidateRef;
  validatedQuote?: ExecutorQuote;
  checkout?: CheckoutState;
  payment: PaymentState;
  pendingCommand?: AgentBrowserCommand;
  /** The checkout was invalidated (stale, wallet change) and must be read again before paying. */
  recheckout?: true;
  /** Executor asked the user to act (log in, add the item); the command stays pending. */
  waitingOnUser?: string;
  order?: { evidence: string; at: string };
  failure?: { code: string; reason: string };
  warnings: string[];
  createdAt: string;
  updatedAt: string;
  /** Seq of the last applied event. */
  version: number;
}

/** Execution limits. Defaults are deliberately strict. */
export interface RunPolicy {
  /** A quote read longer ago than this cannot be authorized. */
  quoteTtlMinutes: number;
  /** Revalidated/checkout total may exceed the reference by at most this (basis points). */
  maxPriceDriftBps: number;
  /** A confirmation request expires after this. */
  confirmationTtlMinutes: number;
  /** How many candidates the run will try before giving up. */
  maxCandidates: number;
  /** Market observations older than this are not candidates. */
  maxObservationAgeMinutes: number;
}

export const DEFAULT_RUN_POLICY: RunPolicy = {
  quoteTtlMinutes: 10,
  maxPriceDriftBps: 1_000,
  confirmationTtlMinutes: 10,
  maxCandidates: 5,
  maxObservationAgeMinutes: 120
};
