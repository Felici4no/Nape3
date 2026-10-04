import { TERMINAL_STATES, type AgentRun, type RunEvent } from "@nape3/agent";
import type { MarketObservation } from "@nape3/domain";
import { VersionConflictError, type ExecutorRecord, type PaymentAttemptRecord, type QuoteRecord, type RunRecord, type RunStore } from "./types";

/** In-process store for tests and the local demo. Same contract as the Postgres store. */
export class MemoryRunStore implements RunStore {
  private readonly executors = new Map<string, ExecutorRecord>();
  private readonly runs = new Map<string, { record: RunRecord; events: RunEvent[]; snapshot: AgentRun }>();
  private readonly observations = new Map<string, MarketObservation[]>();
  private readonly quotes = new Map<string, QuoteRecord[]>();
  private readonly payments = new Map<string, PaymentAttemptRecord>();

  async registerExecutor(record: ExecutorRecord) {
    if (this.executors.has(record.id)) throw new Error("executor already exists");
    this.executors.set(record.id, record);
  }
  async getExecutor(id: string) {
    return this.executors.get(id) ?? null;
  }
  async touchExecutor(id: string, at: string) {
    const e = this.executors.get(id);
    if (e) e.lastSeenAt = at;
  }

  async createRun(record: RunRecord, first: RunEvent, snapshot: AgentRun) {
    if (this.runs.has(record.id)) throw new Error("run already exists");
    if (!this.executors.has(record.executorId)) throw new Error("unknown executor");
    this.runs.set(record.id, { record, events: [structuredClone(first)], snapshot });
  }
  async getRun(id: string) {
    return this.runs.get(id)?.record ?? null;
  }
  async appendEvents(runId: string, expectedVersion: number, events: RunEvent[], snapshot: AgentRun) {
    const entry = this.runs.get(runId);
    if (!entry) throw new Error("unknown run");
    if (entry.events.length !== expectedVersion) throw new VersionConflictError(runId, expectedVersion, entry.events.length);
    events.forEach((e, i) => {
      if (e.seq !== expectedVersion + i + 1) throw new Error("non-contiguous seq");
    });
    entry.events.push(...events.map((e) => structuredClone(e)));
    entry.snapshot = snapshot;
  }
  async listEvents(runId: string, afterSeq = 0) {
    return (this.runs.get(runId)?.events ?? []).filter((e) => e.seq > afterSeq).map((e) => structuredClone(e));
  }
  async activeRunIdsForExecutor(executorId: string) {
    return [...this.runs.values()]
      .filter((r) => r.record.executorId === executorId && !TERMINAL_STATES.includes(r.snapshot.state))
      .map((r) => r.record.id);
  }

  async saveObservations(runId: string, observations: readonly MarketObservation[]) {
    this.observations.set(runId, observations.map(({ observerId: _o, ...rest }) => rest as MarketObservation));
  }
  async saveQuote(record: QuoteRecord) {
    this.quotes.set(record.runId, [...(this.quotes.get(record.runId) ?? []).filter((q) => q.quote.commandId !== record.quote.commandId), record]);
  }
  async listQuotes(runId: string) {
    return this.quotes.get(runId) ?? [];
  }
  async upsertPaymentAttempt(record: PaymentAttemptRecord) {
    this.payments.set(record.runId, record);
  }
  async getPaymentAttempt(runId: string) {
    return this.payments.get(runId) ?? null;
  }
}
