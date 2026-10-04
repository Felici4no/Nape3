import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { reduceRun } from "@nape3/agent";
import { migrate, PostgresRunStore, type SqlClient } from "../src/store/postgres";
import { VersionConflictError } from "../src/store/types";
import { harness, SIGNATURE } from "./harness";

/** The Postgres store on real Postgres (PGlite, in-process WASM). */

let db: PGlite;
let store: PostgresRunStore;

beforeAll(async () => {
  db = new PGlite();
  await migrate(db);
  store = new PostgresRunStore(db as unknown as SqlClient);
});

describe("PostgresRunStore", () => {
  it("persists a full run: append-only events, derived run row, quotes, observations and payment attempt", async () => {
    const h = await harness({ store });
    const { id } = await h.toPix();
    await h.connect(id, 50_000_000n);
    await h.confirmShown(id);
    await h.orchestrator.paymentSubmitted(id, { signature: SIGNATURE });
    await h.answer(id, () => ({ type: "ORDER", confirmed: true, evidence: "ifood:order-confirmation" }));

    const events = await store.listEvents(id);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    const run = reduceRun(events);
    expect(run.state).toBe("ORDER_CONFIRMED");

    const row = (await db.query<{ state: string; version: number; pending_command: unknown }>("select state, version, pending_command from agent_runs where id = $1", [id])).rows[0]!;
    expect(row).toEqual({ state: "ORDER_CONFIRMED", version: events.length, pending_command: null });

    const quotes = await store.listQuotes(id);
    expect(quotes.map((q) => [q.kind, q.accepted, q.reconciled])).toEqual([
      ["revalidation", true, true],
      ["checkout", true, true]
    ]);
    const observations = await db.query<{ id: string; observation: { observerId?: string } }>("select id, observation from market_observations where run_id = $1 order by id", [id]);
    expect(observations.rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(observations.rows.every((r) => r.observation.observerId === undefined)).toBe(true);

    expect(await store.getPaymentAttempt(id)).toMatchObject({ status: "settled", amountCents: 1990, signature: SIGNATURE });
    expect(await store.activeRunIdsForExecutor(h.executorId)).toEqual([]);
  });

  it("never stores tokens or secrets in clear, and rejects concurrent appends", async () => {
    const h = await harness({ store });
    const { id, runToken } = await h.start();
    const dump = JSON.stringify((await db.query("select * from agent_runs where id = $1", [id])).rows) + JSON.stringify((await db.query("select * from browser_executors")).rows);
    expect(dump).not.toContain(runToken);
    expect(dump).not.toContain(h.executorToken.split(".")[1]);

    const events = await store.listEvents(id);
    const run = reduceRun(events);
    const stale = { ...events.at(-1)!, seq: run.version + 1 };
    await expect(store.appendEvents(id, run.version - 1, [stale], run)).rejects.toBeInstanceOf(VersionConflictError);
    await expect(db.query("insert into agent_events (run_id, seq, type, actor, payload, at) values ($1, 1, 'X', 'agent', '{}', now())", [id])).rejects.toThrow();
  });
});
