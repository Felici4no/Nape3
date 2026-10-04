import { readFile } from "node:fs/promises";
import type { AgentRun, RunEvent } from "@nape3/agent";
import type { MarketObservation } from "@nape3/domain";
import { toJson, VersionConflictError, type ExecutorRecord, type PaymentAttemptRecord, type QuoteRecord, type RunRecord, type RunStore } from "./types";

/**
 * Postgres store (Supabase compatible). Works with any client that matches
 * `SqlClient`: node-postgres (`pg.Pool`), Supabase's Postgres connection, or
 * PGlite in tests. The event log is append-only; the run row is a cache
 * updated in the same transaction, guarded by the version check.
 */

export interface SqlQueryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface SqlClient extends SqlQueryable {
  transaction<T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T>;
}

export const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);

export async function migrate(db: SqlQueryable & { exec?: (sql: string) => Promise<unknown> }): Promise<void> {
  const sql = await readFile(new URL("001_agent_runtime.sql", MIGRATIONS_DIR), "utf8");
  if (db.exec) await db.exec(sql);
  else await db.query(sql);
}

/** Adapter for node-postgres' Pool (structural: no hard dependency on `pg`). */
export function pgPoolClient(pool: {
  query: SqlQueryable["query"];
  connect(): Promise<SqlQueryable & { release(): void }>;
}): SqlClient {
  return {
    query: (sql, params) => pool.query(sql, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn(client);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
  };
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

function rowToEvent(row: { run_id: string; seq: number; type: string; actor: string; payload: unknown; at: unknown }): RunEvent {
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
  return { runId: row.run_id, seq: Number(row.seq), type: row.type, actor: row.actor, payload, at: iso(row.at) } as RunEvent;
}

const TERMINAL = "('ORDER_CONFIRMED', 'NO_VALID_OPTION', 'CANCELLED', 'SETTLEMENT_FAILED', 'FAILED')";

export class PostgresRunStore implements RunStore {
  constructor(private readonly db: SqlClient) {}

  async registerExecutor(record: ExecutorRecord) {
    await this.db.query("insert into browser_executors (id, secret_hash, created_at) values ($1, $2, $3)", [record.id, record.secretHash, record.createdAt]);
  }
  async getExecutor(id: string) {
    const { rows } = await this.db.query<{ id: string; secret_hash: string; created_at: unknown; last_seen_at: unknown }>(
      "select id, secret_hash, created_at, last_seen_at from browser_executors where id = $1",
      [id]
    );
    const r = rows[0];
    return r ? { id: r.id, secretHash: r.secret_hash, createdAt: iso(r.created_at), ...(r.last_seen_at ? { lastSeenAt: iso(r.last_seen_at) } : {}) } : null;
  }
  async touchExecutor(id: string, at: string) {
    await this.db.query("update browser_executors set last_seen_at = $2 where id = $1", [id, at]);
  }

  async createRun(record: RunRecord, first: RunEvent, snapshot: AgentRun) {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `insert into agent_runs (id, user_id, executor_id, run_token_hash, execution_mode, intent, state, version, pending_command, snapshot, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6::jsonb, $7, 1, null, $8::jsonb, $9, $9)`,
        [record.id, record.userId ?? null, record.executorId, record.runTokenHash, record.executionMode, toJson(record.intent), snapshot.state, toJson(snapshot), record.createdAt]
      );
      await this.insertEvents(tx, [first]);
    });
  }

  async getRun(id: string) {
    const { rows } = await this.db.query<{ id: string; user_id: string | null; executor_id: string; run_token_hash: string; execution_mode: string; intent: unknown; created_at: unknown }>(
      "select id, user_id, executor_id, run_token_hash, execution_mode, intent, created_at from agent_runs where id = $1",
      [id]
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      ...(r.user_id ? { userId: r.user_id } : {}),
      executorId: r.executor_id,
      runTokenHash: r.run_token_hash,
      executionMode: r.execution_mode as RunRecord["executionMode"],
      intent: (typeof r.intent === "string" ? JSON.parse(r.intent) : r.intent) as RunRecord["intent"],
      createdAt: iso(r.created_at)
    };
  }

  private async insertEvents(tx: SqlQueryable, events: RunEvent[]) {
    for (const e of events) {
      await tx.query("insert into agent_events (run_id, seq, type, actor, payload, at) values ($1, $2, $3, $4, $5::jsonb, $6)", [e.runId, e.seq, e.type, e.actor, toJson(e.payload), e.at]);
    }
  }

  async appendEvents(runId: string, expectedVersion: number, events: RunEvent[], snapshot: AgentRun) {
    await this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ version: number }>("select version from agent_runs where id = $1 for update", [runId]);
      const actual = rows[0] ? Number(rows[0].version) : -1;
      if (actual !== expectedVersion) throw new VersionConflictError(runId, expectedVersion, actual);
      await this.insertEvents(tx, events);
      await tx.query("update agent_runs set state = $2, version = $3, pending_command = $4::jsonb, snapshot = $5::jsonb, updated_at = $6 where id = $1", [
        runId,
        snapshot.state,
        snapshot.version,
        snapshot.pendingCommand ? toJson(snapshot.pendingCommand) : null,
        toJson(snapshot),
        snapshot.updatedAt
      ]);
    });
  }

  async listEvents(runId: string, afterSeq = 0) {
    const { rows } = await this.db.query<Parameters<typeof rowToEvent>[0]>(
      "select run_id, seq, type, actor, payload, at from agent_events where run_id = $1 and seq > $2 order by seq",
      [runId, afterSeq]
    );
    return rows.map(rowToEvent);
  }

  async activeRunIdsForExecutor(executorId: string) {
    const { rows } = await this.db.query<{ id: string }>(`select id from agent_runs where executor_id = $1 and state not in ${TERMINAL} order by created_at`, [executorId]);
    return rows.map((r) => r.id);
  }

  async saveObservations(runId: string, observations: readonly MarketObservation[]) {
    await this.db.transaction(async (tx) => {
      for (const o of observations) {
        const { observerId: _o, ...rest } = o;
        await tx.query(
          `insert into market_observations (run_id, id, source, observed_at, synthetic, observation) values ($1, $2, $3, $4, $5, $6::jsonb)
           on conflict (run_id, id) do nothing`,
          [runId, o.id, o.source, o.observedAt, o.provenance.synthetic, toJson(rest)]
        );
      }
    });
  }

  async saveQuote(r: QuoteRecord) {
    await this.db.query(
      `insert into cart_quotes (run_id, command_id, kind, candidate_id, total_cents, reconciled, accepted, reasons, quote, captured_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
       on conflict (run_id, command_id) do update set accepted = excluded.accepted, reasons = excluded.reasons`,
      [r.runId, r.quote.commandId, r.kind, r.candidateId ?? null, r.quote.quote.totalCents, r.reconciled, r.accepted, toJson(r.reasons), toJson(r.quote), r.quote.capturedAt]
    );
  }

  async listQuotes(runId: string) {
    const { rows } = await this.db.query<{ kind: string; candidate_id: string | null; reconciled: boolean; accepted: boolean; reasons: unknown; quote: unknown }>(
      "select kind, candidate_id, reconciled, accepted, reasons, quote from cart_quotes where run_id = $1 order by captured_at",
      [runId]
    );
    const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
    return rows.map((r) => ({
      runId,
      kind: r.kind as QuoteRecord["kind"],
      ...(r.candidate_id ? { candidateId: r.candidate_id } : {}),
      quote: parse(r.quote),
      reconciled: r.reconciled,
      accepted: r.accepted,
      reasons: parse(r.reasons)
    }));
  }

  async upsertPaymentAttempt(r: PaymentAttemptRecord) {
    await this.db.query(
      `insert into payment_attempts (run_id, amount_cents, gross_usdc, wallet_address, execution_mode, signature, status, settlement_reference, failure_reason, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (run_id) do update set signature = excluded.signature, status = excluded.status,
         settlement_reference = excluded.settlement_reference, failure_reason = excluded.failure_reason, updated_at = excluded.updated_at`,
      [r.runId, r.amountCents, r.grossUsdc.toString(), r.walletAddress, r.executionMode, r.signature ?? null, r.status, r.settlementReference ?? null, r.failureReason ?? null, r.updatedAt]
    );
  }

  async getPaymentAttempt(runId: string) {
    const { rows } = await this.db.query<{
      amount_cents: number;
      gross_usdc: unknown;
      wallet_address: string;
      execution_mode: string;
      signature: string | null;
      status: string;
      settlement_reference: string | null;
      failure_reason: string | null;
      updated_at: unknown;
    }>("select * from payment_attempts where run_id = $1", [runId]);
    const r = rows[0];
    if (!r) return null;
    return {
      runId,
      amountCents: Number(r.amount_cents),
      grossUsdc: BigInt(String(r.gross_usdc)),
      walletAddress: r.wallet_address,
      executionMode: r.execution_mode as PaymentAttemptRecord["executionMode"],
      ...(r.signature ? { signature: r.signature } : {}),
      status: r.status as PaymentAttemptRecord["status"],
      ...(r.settlement_reference ? { settlementReference: r.settlement_reference } : {}),
      ...(r.failure_reason ? { failureReason: r.failure_reason } : {}),
      updatedAt: iso(r.updated_at)
    };
  }
}
