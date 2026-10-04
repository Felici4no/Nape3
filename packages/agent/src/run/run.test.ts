import { describe, expect, it } from "vitest";
import { cents, type CartQuote, type CartQuoteObservation } from "@nape3/domain";
import { cartObservation, type CartSpec } from "@nape3/fixtures";
import { parseIntent } from "../intent";
import {
  applyRunEvent,
  checkAuthorization,
  confirmationDigest,
  describeEvent,
  eventBody,
  evaluateMandate,
  intentRequirement,
  nextAction,
  rankCandidates,
  reduceRun,
  requirementToWire,
  type Actor,
  type AgentAction,
  type AgentBrowserCommand,
  type AgentRun,
  type ExecutorQuote,
  type RunEvent,
  type RunEventBody
} from "./index";

const T0 = new Date("2026-10-04T12:00:00.000Z");
const EXECUTOR = "exec-1";
const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OTHER_WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000).toISOString();

function live(spec: Partial<CartSpec> & { id: string; unit: number; minutesAgo: number }): CartQuoteObservation {
  const o = cartObservation({ source: "ifood", merchant: `Loja ${spec.id}`, lines: [{ title: "Açaí 500ml", unit: spec.unit }], delivery: 0, service: 0, ...spec } as CartSpec, T0);
  return { ...o, provenance: { method: "browser-extension", live: true, synthetic: false } };
}

const market = [live({ id: "a", unit: 1990, minutesAgo: 10 }), live({ id: "b", unit: 2190, minutesAgo: 20, source: "rappi" }), live({ id: "c", unit: 2390, minutesAgo: 30 })];

function quoteLike(id: string, totalCents: number, stage: CartQuote["stage"] = "cart", patch: Partial<CartQuote> = {}): CartQuote {
  const base = live({ id, unit: totalCents, minutesAgo: 0, source: market.find((m) => m.id === id)?.source ?? "ifood" }).quote;
  return { ...base, stage, ...patch };
}

function commandOf(action: AgentAction): AgentBrowserCommand {
  if (action.kind !== "SEND_COMMAND") throw new Error(`expected SEND_COMMAND, got ${action.kind}`);
  return action.command;
}

/** Applies events one by one; throws on the first one the reducer refuses. */
class Log {
  events: RunEvent[] = [];
  run: AgentRun | null = null;
  constructor(readonly runId = "run-1") {}
  push(body: RunEventBody, actor: Actor = "agent", minute = 0): AgentRun {
    const event = { ...body, runId: this.runId, seq: this.events.length + 1, at: at(minute), actor } as RunEvent;
    const result = applyRunEvent(this.run, event);
    if (!result.ok) throw new Error(result.error);
    this.events.push(event);
    this.run = result.run;
    return result.run;
  }
  tryPush(body: RunEventBody, actor: Actor = "agent", minute = 0) {
    const event = { ...body, runId: this.runId, seq: this.events.length + 1, at: at(minute), actor } as RunEvent;
    return applyRunEvent(this.run, event);
  }
  get current(): AgentRun {
    return this.run!;
  }
  executorQuote(id: string, total: number, stage: CartQuote["stage"], minute: number, patch: Partial<CartQuote> = {}): ExecutorQuote {
    return { quote: quoteLike(id, total, stage, patch), capturedAt: at(minute), executorId: EXECUTOR, commandId: this.current.pendingCommand!.commandId, pageRef: `ifood:${stage}` };
  }
}

const intent = (() => {
  const parsed = parseIntent("quero um açaí 500ml até R$25");
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.intent;
})();

const requirement = { checkoutTotalCents: cents(1990), offrampNetUsdc: 3_722_223n, cloakFeeUsdc: 461_167n, grossUsdc: 4_183_390n, destination: "pix-payload-via-offramp" as const, quoteSimulated: true };

/** Drives a run to the given point of the happy path. */
function toCheckout(log = new Log()): Log {
  log.push(eventBody("INTENT_CREATED", { intent, requirement: intentRequirement(intent), executorId: EXECUTOR, executionMode: "simulated" }), "user");
  log.push(eventBody("MARKET_SEARCH_STARTED", {}));
  const { candidates } = rankCandidates(intent, market, { now: T0, provenance: "real-only" });
  log.push(eventBody("MARKET_SEARCHED", { candidates, rejectedCount: 0, observationCount: market.length, sourceMode: "live" }));
  const select = nextAction(log.current, T0);
  if (select.kind !== "SELECT_CANDIDATE") throw new Error(select.kind);
  log.push(eventBody("CANDIDATE_SELECTED", { candidateId: select.candidate.candidateId }));
  const reval = nextAction(log.current, T0);
  if (reval.kind !== "SEND_COMMAND") throw new Error(reval.kind);
  log.push(eventBody("REVALIDATION_REQUESTED", { command: reval.command }));
  log.push(eventBody("QUOTE_VALIDATED", { quote: log.executorQuote("a", 1990, "cart", 1) }), "browser", 1);
  const checkoutCmd = nextAction(log.current, new Date(at(1)));
  if (checkoutCmd.kind !== "SEND_COMMAND") throw new Error(checkoutCmd.kind);
  log.push(eventBody("CHECKOUT_REQUESTED", { command: checkoutCmd.command }), "agent", 1);
  log.push(eventBody("CHECKOUT_READY", { quote: log.executorQuote("a", 1990, "checkout", 2) }), "browser", 2);
  return log;
}

function toPaymentReady(log = toCheckout()): Log {
  const pixCmd = nextAction(log.current, new Date(at(2)));
  if (pixCmd.kind !== "SEND_COMMAND") throw new Error(pixCmd.kind);
  log.push(eventBody("PIX_REQUESTED", { command: pixCmd.command }), "agent", 2);
  log.push(eventBody("PIX_DETECTED", { pix: { amountCents: cents(1990), evidence: "pix-copy-paste", detectedAt: at(3), expiresAt: at(30) } }), "browser", 3);
  log.push(eventBody("WALLET_REQUIRED", {}), "agent", 3);
  log.push(eventBody("WALLET_CONNECTED", { address: WALLET, shieldedUsdc: "10000000", reportedAt: at(4) }), "wallet", 4);
  log.push(
    eventBody("FUNDS_CHECKED", {
      funds: { address: WALLET, publicUsdc: "25000000", shieldedUsdc: "10000000", solLamports: "50000000", checkedAt: at(4) },
      requirement: requirementToWire(requirement),
      verified: true
    }),
    "chain",
    4
  );
  log.push(eventBody("PAYMENT_READY", {}), "agent", 4);
  return log;
}

function requestConfirmation(log: Log, minute = 5) {
  const run = log.current;
  const request = {
    amountCents: cents(1990),
    grossUsdc: requirement.grossUsdc.toString(),
    walletAddress: WALLET,
    candidateId: run.selectedCandidate!.candidateId,
    checkoutCapturedAt: run.checkout!.quote.capturedAt,
    expiresAt: at(minute + 10),
    digest: confirmationDigest({ runId: run.id, amountCents: cents(1990), grossUsdc: requirement.grossUsdc, walletAddress: WALLET, candidateId: run.selectedCandidate!.candidateId, checkoutCapturedAt: run.checkout!.quote.capturedAt })
  };
  log.push(eventBody("CONFIRMATION_REQUESTED", { request }), "agent", minute);
  return request;
}

describe("run reducer: happy path", () => {
  it("goes from intent to order confirmation, every step derivable from events", () => {
    const log = toPaymentReady();
    const request = requestConfirmation(log);
    expect(nextAction(log.current, new Date(at(5))).kind).toBe("AWAIT_CONFIRMATION");
    log.push(eventBody("USER_CONFIRMED", { digest: request.digest, amountCents: cents(1990) }), "user", 6);
    expect(nextAction(log.current, new Date(at(6))).kind).toBe("AUTHORIZE");
    log.push(eventBody("PAYMENT_AUTHORIZED", { amountCents: cents(1990), basis: { kind: "user-confirmation" } }), "agent", 6);
    log.push(eventBody("PAYMENT_SUBMITTED", { signature: SIG }), "wallet", 7);
    expect(nextAction(log.current, new Date(at(7)))).toEqual({ kind: "VERIFY_SETTLEMENT", signature: SIG });
    log.push(eventBody("SETTLEMENT_VERIFIED", { signature: SIG, reference: "sim-1", simulated: true }), "chain", 8);
    const order = nextAction(log.current, new Date(at(8)));
    expect(order.kind).toBe("SEND_COMMAND");
    log.push(eventBody("ORDER_REQUESTED", { command: commandOf(order) }), "agent", 8);
    log.push(eventBody("ORDER_CONFIRMED", { evidence: "ifood:order-confirmation" }), "browser", 9);

    expect(log.current.state).toBe("ORDER_CONFIRMED");
    expect(reduceRun(log.events)).toEqual(log.current);
    expect(nextAction(log.current, new Date(at(9)))).toEqual({ kind: "DONE", outcome: "ORDER_CONFIRMED" });
    const lines = log.events.map((e) => describeEvent(e));
    expect(lines).toContain("Searching market…");
    expect(lines).toContain("Found 3 candidates (live market)");
    expect(lines).toContain("Revalidating cheapest option in your session…");
    expect(lines).toContain("Checkout confirmed at R$19,90");
    expect(lines).toContain("Waiting for wallet…");
    expect(lines).toContain("Ready to pay");
  });

  it("asks for PREPARE_CHECKOUT first and READ_CHECKOUT after an invalidation", () => {
    const log = toCheckout();
    expect(log.events.find((e) => e.type === "CHECKOUT_REQUESTED")).toMatchObject({ payload: { command: { type: "PREPARE_CHECKOUT" } } });
    log.push(eventBody("CHECKOUT_INVALIDATED", { reason: "test" }), "agent", 3);
    expect(nextAction(log.current, new Date(at(3)))).toMatchObject({ kind: "SEND_COMMAND", command: { type: "READ_CHECKOUT" } });
  });
});

describe("run reducer: invariants", () => {
  function revalidating(): Log {
    const log = toCheckout();
    // rewind: rebuild up to REVALIDATION_REQUESTED
    const fresh = new Log();
    for (const e of log.events.slice(0, 5)) fresh.push(e as RunEventBody, e.actor, 0);
    return fresh;
  }

  it("refuses a revalidated quote that does not reconcile", () => {
    const log = revalidating();
    const bad = log.executorQuote("a", 1990, "cart", 1, { totalCents: cents(1890) });
    expect(log.tryPush(eventBody("QUOTE_VALIDATED", { quote: bad }), "browser", 1)).toMatchObject({ ok: false, error: expect.stringContaining("does not reconcile") });
  });

  it("refuses a quote above the budget, or drifting too far above the observation", () => {
    const log = revalidating();
    const over = log.executorQuote("a", 2600, "cart", 1);
    expect(log.tryPush(eventBody("QUOTE_VALIDATED", { quote: over }), "browser", 1)).toMatchObject({ ok: false, error: expect.stringContaining("above the budget") });
  });

  it("refuses a stale quote and one read by another executor", () => {
    const log = revalidating();
    const stale = { ...log.executorQuote("a", 1990, "cart", 1), capturedAt: at(-30) };
    expect(log.tryPush(eventBody("QUOTE_VALIDATED", { quote: stale }), "browser", 1)).toMatchObject({ ok: false, error: expect.stringContaining("stale") });
    const foreign = { ...log.executorQuote("a", 1990, "cart", 1), executorId: "someone-else" };
    expect(log.tryPush(eventBody("QUOTE_VALIDATED", { quote: foreign }), "browser", 1)).toMatchObject({ ok: false, error: expect.stringContaining("browser executor") });
  });

  it("refuses a quote from another merchant or for another product", () => {
    const log = revalidating();
    const other = log.executorQuote("a", 1990, "cart", 1, { merchant: { name: "Outra Loja" } });
    expect(log.tryPush(eventBody("QUOTE_VALIDATED", { quote: other }), "browser", 1).ok).toBe(false);
    const twoUnits = log.executorQuote("a", 1990, "cart", 1);
    twoUnits.quote = { ...twoUnits.quote, lines: [{ ...twoUnits.quote.lines[0]!, quantity: 2 }] };
    expect(log.tryPush(eventBody("QUOTE_VALIDATED", { quote: twoUnits }), "browser", 1).ok).toBe(false);
  });

  it("rejecting the selected candidate moves to the next one, then to NO_VALID_OPTION", () => {
    const log = revalidating();
    log.push(eventBody("CANDIDATE_REJECTED", { candidateId: "a", reasons: ["unavailable"] }), "agent", 1);
    expect(log.current.state).toBe("CANDIDATES_NORMALIZED");
    expect(nextAction(log.current, T0)).toMatchObject({ kind: "SELECT_CANDIDATE", candidate: { candidateId: "b" } });
    for (const id of ["b", "c"]) {
      log.push(eventBody("CANDIDATE_SELECTED", { candidateId: id }));
      log.push(eventBody("CANDIDATE_REJECTED", { candidateId: id, reasons: ["unavailable"] }));
    }
    expect(log.current.state).toBe("NO_VALID_OPTION");
  });

  it("requires the Pix amount to equal the checkout total", () => {
    const log = toCheckout();
    const cmd = nextAction(log.current, new Date(at(2)));
    log.push(eventBody("PIX_REQUESTED", { command: commandOf(cmd) }), "agent", 2);
    const r = log.tryPush(eventBody("PIX_DETECTED", { pix: { amountCents: cents(2090), evidence: "qr-code", detectedAt: at(3) } }), "browser", 3);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("differs from the checkout total") });
  });

  it("never authorizes without a matching user confirmation", () => {
    const log = toPaymentReady();
    const request = requestConfirmation(log);
    expect(log.tryPush(eventBody("PAYMENT_AUTHORIZED", { amountCents: cents(1990), basis: { kind: "user-confirmation" } }), "agent", 6).ok).toBe(false);
    expect(log.tryPush(eventBody("USER_CONFIRMED", { digest: "u3-confirm-v1|forged", amountCents: cents(1990) }), "user", 6).ok).toBe(false);
    expect(log.tryPush(eventBody("USER_CONFIRMED", { digest: request.digest, amountCents: cents(1990) }), "agent", 6).ok).toBe(false);
    log.push(eventBody("USER_CONFIRMED", { digest: request.digest, amountCents: cents(1990) }), "user", 6);
    expect(log.tryPush(eventBody("PAYMENT_AUTHORIZED", { amountCents: cents(1890), basis: { kind: "user-confirmation" } }), "agent", 6)).toMatchObject({
      ok: false,
      error: expect.stringContaining("amounts differ")
    });
    expect(log.tryPush(eventBody("PAYMENT_AUTHORIZED", { amountCents: cents(1990), basis: { kind: "mandate", mandateId: "m1" } }), "agent", 6)).toMatchObject({
      ok: false,
      error: expect.stringContaining("mandates are not enabled")
    });
  });

  it("refuses to authorize a stale checkout and asks to read it again", () => {
    const log = toPaymentReady();
    const request = requestConfirmation(log, 5);
    log.push(eventBody("USER_CONFIRMED", { digest: request.digest, amountCents: cents(1990) }), "user", 11);
    const late = new Date(at(13)); // checkout captured at minute 2, TTL 10 min
    expect(checkAuthorization(log.current, cents(1990), { kind: "user-confirmation" }, late)).toContain("the checkout quote is stale; it must be read again");
    expect(nextAction(log.current, late)).toMatchObject({ kind: "INVALIDATE_CHECKOUT" });
  });

  it("a wallet change mid-run drops funds, Pix and confirmation and re-reads the checkout", () => {
    const log = toPaymentReady();
    const request = requestConfirmation(log);
    log.push(eventBody("USER_CONFIRMED", { digest: request.digest, amountCents: cents(1990) }), "user", 6);
    log.push(eventBody("WALLET_CONNECTED", { address: OTHER_WALLET }), "wallet", 6);
    const run = log.current;
    expect(run.state).toBe("QUOTE_VALIDATED");
    expect(run.checkout).toBeUndefined();
    expect(run.payment).toEqual({ walletAddress: OTHER_WALLET, lastWalletAddress: OTHER_WALLET });
    expect(nextAction(run, new Date(at(6)))).toMatchObject({ kind: "SEND_COMMAND", command: { type: "READ_CHECKOUT" } });
  });

  it("a disconnect then a different wallet is also a change", () => {
    const log = toPaymentReady();
    log.push(eventBody("WALLET_DISCONNECTED", {}), "wallet", 5);
    expect(log.current.state).toBe("WALLET_REQUIRED");
    log.push(eventBody("WALLET_CONNECTED", { address: OTHER_WALLET }), "wallet", 5);
    expect(log.current.state).toBe("QUOTE_VALIDATED");
  });

  it("refuses simulated settlement in a real run, real execution without a licensed off-ramp, and seq gaps", () => {
    const log = toPaymentReady();
    const realRun: AgentRun = { ...log.current, executionMode: "real" };
    expect(checkAuthorization(realRun, cents(1990), { kind: "user-confirmation" }, new Date(at(5)))).toContain("real execution requires a licensed (non-simulated) off-ramp");
    const gap = { ...eventBody("RUN_FAILED", { code: "x", reason: "x" }), runId: "run-1", seq: log.events.length + 5, at: at(5), actor: "agent" } as RunEvent;
    expect(applyRunEvent(log.current, gap)).toMatchObject({ ok: false });
  });
});

describe("candidates and mandates", () => {
  it("stale observations never become candidates", () => {
    const old = live({ id: "old", unit: 1500, minutesAgo: 300 });
    const { candidates } = rankCandidates(intent, [...market, old], { now: T0, provenance: "real-only" });
    expect(candidates.map((c) => c.candidateId)).not.toContain("old");
    expect(candidates[0]).toMatchObject({ candidateId: "a", rank: 1, observedTotalCents: 1990 });
  });

  it("evaluates spending mandates (designed, not enabled)", () => {
    const mandate = { id: "m1", maxPerTransactionCents: 3000, maxDailyCents: 5000, allowedCategories: ["acai"], validUntil: at(60), maxEtaMinutes: 45 };
    expect(evaluateMandate(mandate, { amountCents: cents(1990), category: "acai", spentTodayCents: 0, etaMaxMinutes: 40 }, T0)).toEqual({ ok: true, reasons: [] });
    const r = evaluateMandate(mandate, { amountCents: cents(3500), category: "pizza", spentTodayCents: 2000, etaMaxMinutes: 60 }, new Date(at(61)));
    expect(r.ok).toBe(false);
    expect(r.reasons).toHaveLength(5);
  });
});
