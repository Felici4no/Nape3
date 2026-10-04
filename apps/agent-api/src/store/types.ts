import type { AgentRun, ExecutorQuote, RunEvent } from "@nape3/agent";
import type { MarketObservation, PurchaseIntent } from "@nape3/domain";

export interface RunRecord {
  id: string;
  userId?: string;
  executorId: string;
  runTokenHash: string;
  executionMode: AgentRun["executionMode"];
  intent: PurchaseIntent;
  createdAt: string;
}

export interface ExecutorRecord {
  id: string;
  secretHash: string;
  createdAt: string;
  lastSeenAt?: string;
}

export interface QuoteRecord {
  runId: string;
  kind: "revalidation" | "checkout";
  candidateId?: string;
  quote: ExecutorQuote;
  reconciled: boolean;
  accepted: boolean;
  reasons: string[];
}

export interface PaymentAttemptRecord {
  runId: string;
  amountCents: number;
  grossUsdc: bigint;
  walletAddress: string;
  executionMode: AgentRun["executionMode"];
  signature?: string;
  status: "authorized" | "submitted" | "settled" | "failed";
  settlementReference?: string;
  failureReason?: string;
  updatedAt: string;
}

export class VersionConflictError extends Error {
  constructor(
    readonly runId: string,
    readonly expected: number,
    readonly actual: number
  ) {
    super(`run ${runId}: expected version ${expected}, store has ${actual}`);
    this.name = "VersionConflictError";
  }
}

/**
 * Persistence for the runtime. The event log is the truth; `snapshot` is a
 * derived cache written in the same transaction as the events it reflects.
 */
export interface RunStore {
  registerExecutor(record: ExecutorRecord): Promise<void>;
  getExecutor(id: string): Promise<ExecutorRecord | null>;
  touchExecutor(id: string, at: string): Promise<void>;

  /** Creates the run with its first event (INTENT_CREATED). */
  createRun(record: RunRecord, first: RunEvent, snapshot: AgentRun): Promise<void>;
  getRun(id: string): Promise<RunRecord | null>;
  /** Appends events if the run is still at `expectedVersion`; otherwise throws VersionConflictError. */
  appendEvents(runId: string, expectedVersion: number, events: RunEvent[], snapshot: AgentRun): Promise<void>;
  listEvents(runId: string, afterSeq?: number): Promise<RunEvent[]>;
  /** Non-terminal runs bound to an executor (to serve its pending commands). */
  activeRunIdsForExecutor(executorId: string): Promise<string[]>;

  saveObservations(runId: string, observations: readonly MarketObservation[]): Promise<void>;
  saveQuote(record: QuoteRecord): Promise<void>;
  upsertPaymentAttempt(record: PaymentAttemptRecord): Promise<void>;
  getPaymentAttempt(runId: string): Promise<PaymentAttemptRecord | null>;
  listQuotes(runId: string): Promise<QuoteRecord[]>;
}

/** JSON with bigint → decimal string (for jsonb snapshots and HTTP). */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
}
