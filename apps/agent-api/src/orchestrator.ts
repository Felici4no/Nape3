import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  applyRunEvent,
  checkExecutorQuote,
  checkPix,
  confirmationDigest,
  DEFAULT_RUN_POLICY,
  describeEvent,
  describeLog,
  eventBody,
  fundsToWire,
  intentRequirement,
  nextAction,
  parseIntent,
  rankCandidates,
  reduceRun,
  requirementToWire,
  resultFits,
  type Actor,
  type AgentAction,
  type AgentRun,
  type BrowserResult,
  type ExecutionMode,
  type ExecutorQuote,
  type RunEvent,
  type RunEventBody,
  type RunPolicy
} from "@nape3/agent";
import { isSolanaAddress, readWalletBalances } from "@nape3/chain";
import { verifyCartQuote, type CartQuote } from "@nape3/domain";
import { sanitizeObservation } from "@nape3/market";
import type { ChainPort, FundingPort, MarketPort, SettlementPort } from "./ports";
import { VersionConflictError, type RunStore } from "./store/types";

/**
 * The runtime. It owns no business rules: it loads a run's events, reduces
 * them, asks the pure core what to do next, performs the agent-side actions
 * (market search, command dispatch, funding check, authorization,
 * settlement verification) and appends events, each one validated by the
 * core's reducer before it is stored.
 */

export class RuntimeError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export interface RunUpdate {
  event: RunEvent;
  run: AgentRun;
  message: string;
}

export interface OrchestratorDeps {
  store: RunStore;
  market: MarketPort;
  funding: FundingPort;
  settlement: SettlementPort;
  /** Chain reads (RPC Fast in production). Without it, public balances are client-reported and flagged unverified. */
  chain?: ChainPort;
  now?: () => Date;
  policy?: RunPolicy;
  /** Called after every appended event (SSE fan-out). */
  publish?: (update: RunUpdate) => void;
  /** Re-run `advance` later (settlement still pending). Tests pass a no-op and call advance themselves. */
  schedule?: (runId: string, delayMs: number) => void;
  log?: (entry: Record<string, unknown>) => void;
  randomId?: () => string;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const token = () => randomBytes(32).toString("base64url");

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

const MAX_STEPS = 25;
const SETTLEMENT_RETRY_MS = 4_000;

export class Orchestrator {
  private readonly now: () => Date;
  private readonly policy: RunPolicy;
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly log: (entry: Record<string, unknown>) => void;
  private readonly randomId: () => string;

  constructor(private readonly deps: OrchestratorDeps) {
    this.now = deps.now ?? (() => new Date());
    this.policy = deps.policy ?? DEFAULT_RUN_POLICY;
    this.log = deps.log ?? (() => {});
    this.randomId = deps.randomId ?? (() => randomBytes(9).toString("base64url"));
  }

  // -------------------------------------------------------------------------
  // Executors and auth
  // -------------------------------------------------------------------------

  async registerExecutor(): Promise<{ executorId: string; executorToken: string }> {
    const executorId = `ex_${this.randomId()}`;
    const secret = token();
    await this.deps.store.registerExecutor({ id: executorId, secretHash: sha256(secret), createdAt: this.now().toISOString() });
    return { executorId, executorToken: `${executorId}.${secret}` };
  }

  /** `executorId.secret` → executorId, or throws 401. */
  async authenticateExecutor(bearer: string | undefined): Promise<string> {
    const [id, secret] = (bearer ?? "").split(".", 2);
    if (!id || !secret) throw new RuntimeError(401, "executor token required");
    const record = await this.deps.store.getExecutor(id);
    if (!record || !safeEqualHex(record.secretHash, sha256(secret))) throw new RuntimeError(401, "invalid executor token");
    await this.deps.store.touchExecutor(id, this.now().toISOString());
    return id;
  }

  async authorizeRun(runId: string, runToken: string | undefined): Promise<void> {
    const record = await this.deps.store.getRun(runId);
    if (!record) throw new RuntimeError(404, "run not found");
    if (!runToken || !safeEqualHex(record.runTokenHash, sha256(runToken))) throw new RuntimeError(401, "invalid run token");
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async load(runId: string): Promise<{ run: AgentRun; events: RunEvent[] }> {
    const events = await this.deps.store.listEvents(runId);
    if (events.length === 0) throw new RuntimeError(404, "run not found");
    return { run: reduceRun(events, this.policy), events };
  }

  async status(runId: string) {
    const { run, events } = await this.load(runId);
    return { run, events: describeLog(events), nextAction: nextAction(run, this.now(), this.policy) };
  }

  /** Pending commands for an executor, across its active runs. */
  async commandsFor(executorId: string) {
    const ids = await this.deps.store.activeRunIdsForExecutor(executorId);
    const commands = [];
    for (const id of ids) {
      const { run } = await this.load(id);
      if (run.pendingCommand && run.executorId === executorId) commands.push(run.pendingCommand);
    }
    return commands;
  }

  // -------------------------------------------------------------------------
  // Writes (serialized per run)
  // -------------------------------------------------------------------------

  private withLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(runId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    this.locks.set(runId, next);
    return next.finally(() => {
      if (this.locks.get(runId) === next) this.locks.delete(runId);
    });
  }

  /** Validates `body` against the reducer and appends it. Returns the new run, or the refusal. */
  private async append(run: AgentRun, body: RunEventBody, actor: Actor): Promise<{ ok: true; run: AgentRun } | { ok: false; error: string }> {
    const event = { ...body, runId: run.id, seq: run.version + 1, at: this.now().toISOString(), actor } as RunEvent;
    const result = applyRunEvent(run, event, this.policy);
    if (!result.ok) return result;
    try {
      await this.deps.store.appendEvents(run.id, run.version, [event], result.run);
    } catch (error) {
      if (error instanceof VersionConflictError) throw new RuntimeError(409, "run changed concurrently; retry");
      throw error;
    }
    this.log({ event: "run.event", runId: run.id, seq: event.seq, type: event.type, state: result.run.state });
    this.deps.publish?.({ event, run: result.run, message: describeEvent(event, result.run) });
    return { ok: true, run: result.run };
  }

  /** Appends an event the runtime itself produced; a refusal here is a bug, so the run fails loudly. */
  private async appendOwn(run: AgentRun, body: RunEventBody, actor: Actor = "agent"): Promise<AgentRun> {
    const result = await this.append(run, body, actor);
    if (result.ok) return result.run;
    this.log({ event: "run.invariant_refusal", runId: run.id, type: body.type, error: result.error });
    const failed = await this.append(run, eventBody("RUN_FAILED", { code: "invariant", reason: result.error }), "system");
    return failed.ok ? failed.run : run;
  }

  async createRun(input: { request: string; executorId: string; userId?: string; executionMode?: ExecutionMode }): Promise<{ run: AgentRun; runToken: string }> {
    const executionMode = input.executionMode ?? "simulated";
    if (executionMode === "real" && this.deps.funding.simulated) {
      throw new RuntimeError(422, "real execution is disabled until a licensed off-ramp is integrated");
    }
    if (!(await this.deps.store.getExecutor(input.executorId))) throw new RuntimeError(422, "unknown browser executor");
    const parsed = parseIntent(input.request.slice(0, 200));
    if (!parsed.ok) throw new RuntimeError(422, `intent not understood: ${parsed.reason}`);

    const runId = `run_${this.randomId()}`;
    const runToken = token();
    const first = {
      ...eventBody("INTENT_CREATED", {
        intent: parsed.intent,
        requirement: intentRequirement(parsed.intent),
        executorId: input.executorId,
        executionMode,
        ...(input.userId ? { userId: input.userId } : {})
      }),
      runId,
      seq: 1,
      at: this.now().toISOString(),
      actor: "user" as const
    } as RunEvent;
    const created = applyRunEvent(null, first, this.policy);
    if (!created.ok) throw new RuntimeError(422, created.error);
    await this.deps.store.createRun(
      {
        id: runId,
        ...(input.userId ? { userId: input.userId } : {}),
        executorId: input.executorId,
        runTokenHash: sha256(runToken),
        executionMode,
        intent: parsed.intent,
        createdAt: first.at
      },
      first,
      created.run
    );
    this.deps.publish?.({ event: first, run: created.run, message: describeEvent(first, created.run) });
    const run = await this.advance(runId);
    return { run, runToken };
  }

  /** Performs agent-side actions until the run waits on someone else (or is done). */
  advance(runId: string): Promise<AgentRun> {
    return this.withLock(runId, () => this.advanceUnlocked(runId));
  }

  private async advanceUnlocked(runId: string): Promise<AgentRun> {
    let { run } = await this.load(runId);
    for (let step = 0; step < MAX_STEPS; step++) {
      const action = nextAction(run, this.now(), this.policy);
      const next = await this.perform(run, action);
      if (!next) return run;
      run = next;
    }
    this.log({ event: "run.step_limit", runId });
    return run;
  }

  /** Returns the updated run, or null when the run is waiting. */
  private async perform(run: AgentRun, action: AgentAction): Promise<AgentRun | null> {
    switch (action.kind) {
      case "SEARCH_MARKET": {
        if (run.state === "INTENT_CAPTURED") run = await this.appendOwn(run, eventBody("MARKET_SEARCH_STARTED", {}));
        try {
          const search = await this.deps.market.search(this.now());
          const { candidates, rejectedCount } = rankCandidates(run.intent, search.observations, {
            now: this.now(),
            provenance: search.mode === "live" ? "real-only" : "synthetic-only",
            ...(search.marketRegion ? { marketRegion: search.marketRegion } : {}),
            policy: this.policy
          });
          const used = new Set(candidates.map((c) => c.candidateId));
          await this.deps.store.saveObservations(run.id, search.observations.filter((o) => used.has(o.id)));
          return this.appendOwn(run, eventBody("MARKET_SEARCHED", { candidates, rejectedCount, observationCount: search.observations.length, sourceMode: search.mode }));
        } catch (error) {
          return this.appendOwn(run, eventBody("RUN_FAILED", { code: "market_unavailable", reason: error instanceof Error ? error.message : String(error) }), "system");
        }
      }
      case "SELECT_CANDIDATE":
        return this.appendOwn(run, eventBody("CANDIDATE_SELECTED", { candidateId: action.candidate.candidateId }));
      case "SEND_COMMAND": {
        const command = action.command;
        const type =
          command.type === "REVALIDATE_CANDIDATE"
            ? eventBody("REVALIDATION_REQUESTED", { command })
            : command.type === "READ_PIX"
              ? eventBody("PIX_REQUESTED", { command })
              : command.type === "VERIFY_ORDER"
                ? eventBody("ORDER_REQUESTED", { command })
                : eventBody("CHECKOUT_REQUESTED", { command });
        return this.appendOwn(run, type);
      }
      case "INVALIDATE_CHECKOUT":
        return this.appendOwn(run, eventBody("CHECKOUT_INVALIDATED", { reason: action.reason }));
      case "REQUIRE_WALLET":
        return this.appendOwn(run, eventBody("WALLET_REQUIRED", {}));
      case "REUSE_WALLET":
        return this.appendOwn(run, eventBody("WALLET_CONNECTED", { address: action.address }));
      case "CHECK_FUNDS":
        return this.checkFunds(run, action.address, action.shieldedUsdc);
      case "EVALUATE_FUNDS":
        return this.appendOwn(run, action.ready ? eventBody("PAYMENT_READY", {}) : eventBody("SHIELD_REQUIRED", {}));
      case "REQUEST_CONFIRMATION": {
        const pix = run.checkout!.pix!;
        const req = run.payment.requirement!;
        const walletAddress = run.payment.walletAddress!;
        const candidateId = run.selectedCandidate!.candidateId;
        const checkoutCapturedAt = run.checkout!.quote.capturedAt;
        const expiresAt = new Date(this.now().getTime() + this.policy.confirmationTtlMinutes * 60_000);
        const pixExpiry = pix.expiresAt ? Date.parse(pix.expiresAt) : Infinity;
        const request = {
          amountCents: pix.amountCents,
          grossUsdc: req.grossUsdc.toString(),
          walletAddress,
          candidateId,
          checkoutCapturedAt,
          expiresAt: new Date(Math.min(expiresAt.getTime(), pixExpiry)).toISOString(),
          digest: confirmationDigest({ runId: run.id, amountCents: pix.amountCents, grossUsdc: req.grossUsdc, walletAddress, candidateId, checkoutCapturedAt })
        };
        return this.appendOwn(run, eventBody("CONFIRMATION_REQUESTED", { request }));
      }
      case "AUTHORIZE": {
        const amountCents = run.payment.confirmation!.amountCents;
        const result = await this.append(run, eventBody("PAYMENT_AUTHORIZED", { amountCents, basis: { kind: "user-confirmation" } }), "agent");
        if (!result.ok) return this.appendOwn(run, eventBody("RUN_FAILED", { code: "authorization_refused", reason: result.error }), "system");
        await this.deps.store.upsertPaymentAttempt({
          runId: run.id,
          amountCents,
          grossUsdc: result.run.payment.requirement!.grossUsdc,
          walletAddress: result.run.payment.walletAddress!,
          executionMode: run.executionMode,
          status: "authorized",
          updatedAt: this.now().toISOString()
        });
        return result.run;
      }
      case "VERIFY_SETTLEMENT": {
        const check = await this.deps.settlement.verify(run, action.signature, this.now());
        const attempt = await this.deps.store.getPaymentAttempt(run.id);
        if (check.status === "pending") {
          this.deps.schedule?.(run.id, SETTLEMENT_RETRY_MS);
          return null;
        }
        if (attempt) {
          await this.deps.store.upsertPaymentAttempt({
            ...attempt,
            status: check.status === "settled" ? "settled" : "failed",
            ...(check.status === "settled" ? { settlementReference: check.reference } : { failureReason: check.reason }),
            updatedAt: this.now().toISOString()
          });
        }
        return check.status === "settled"
          ? this.appendOwn(run, eventBody("SETTLEMENT_VERIFIED", { signature: action.signature, reference: check.reference, simulated: check.simulated }), "chain")
          : this.appendOwn(run, eventBody("SETTLEMENT_FAILED", { reason: check.reason }), "chain");
      }
      default:
        return null; // waiting on browser, wallet, user — or done
    }
  }

  private async checkFunds(run: AgentRun, address: string, shieldedUsdc: bigint): Promise<AgentRun> {
    const pix = run.checkout!.pix!;
    const requirement = await this.deps.funding.requirement(pix.amountCents, pix, this.now());
    let publicUsdc: bigint;
    let solLamports: bigint;
    let verified = false;
    if (this.deps.chain) {
      const balances = await readWalletBalances(this.deps.chain.provider, address, this.deps.chain.usdcMint, this.now());
      publicUsdc = balances.publicUsdc;
      solLamports = balances.solLamports;
      verified = true;
    } else {
      const report = this.lastPublicReport.get(run.id);
      publicUsdc = report?.publicUsdc ?? 0n;
      solLamports = report?.solLamports ?? 0n;
    }
    const funds = { address, publicUsdc, shieldedUsdc, solLamports, checkedAt: this.now().toISOString() };
    return this.appendOwn(run, eventBody("FUNDS_CHECKED", { funds: fundsToWire(funds), requirement: requirementToWire(requirement), verified }), verified ? "chain" : "wallet");
  }

  /** Client-reported public balances, only used when no chain provider is configured (flagged unverified). */
  private readonly lastPublicReport = new Map<string, { publicUsdc: bigint; solLamports: bigint }>();

  // -------------------------------------------------------------------------
  // Inputs from the browser executor, the wallet and the user
  // -------------------------------------------------------------------------

  async browserResult(runId: string, executorId: string, result: BrowserResult): Promise<AgentRun> {
    return this.withLock(runId, async () => {
      const { run } = await this.load(runId);
      if (run.executorId !== executorId) throw new RuntimeError(403, "this run is bound to another browser executor");
      const pending = run.pendingCommand;
      if (!pending || !resultFits(pending, result)) throw new RuntimeError(409, "result does not answer the pending command");
      const candidateId = run.selectedCandidate?.candidateId;

      const reject = (reasons: string[]) => eventBody("CANDIDATE_REJECTED", { candidateId: candidateId!, reasons });
      let body: RunEventBody;
      let actor: Actor = "browser";

      switch (result.type) {
        case "STARTED":
          if (pending.type !== "REVALIDATE_CANDIDATE" || run.state !== "REVALIDATION_REQUESTED") return run;
          body = eventBody("REVALIDATION_STARTED", { commandId: pending.commandId });
          break;
        case "NEEDS_USER":
          body = eventBody("BROWSER_NEEDS_USER", { commandId: pending.commandId, reason: result.reason.slice(0, 200) });
          break;
        case "QUOTE": {
          const quote = sanitizeQuote(result.quote, result.capturedAt);
          if (!quote) {
            body = pending.type === "REVALIDATE_CANDIDATE" ? reject(["browser returned a malformed quote"]) : eventBody("RUN_FAILED", { code: "malformed_quote", reason: "browser returned a malformed checkout" });
            break;
          }
          const executorQuote: ExecutorQuote = { quote, capturedAt: result.capturedAt, executorId, commandId: pending.commandId, pageRef: result.pageRef.slice(0, 40) };
          const stage = pending.type === "REVALIDATE_CANDIDATE" ? "revalidation" : "checkout";
          const reasons = checkExecutorQuote(run, executorQuote, stage, this.now(), this.policy);
          await this.deps.store.saveQuote({
            runId,
            kind: stage,
            ...(candidateId ? { candidateId } : {}),
            quote: executorQuote,
            reconciled: verifyCartQuote(quote).consistent,
            accepted: reasons.length === 0,
            reasons
          });
          if (reasons.length === 0) body = stage === "revalidation" ? eventBody("QUOTE_VALIDATED", { quote: executorQuote }) : eventBody("CHECKOUT_READY", { quote: executorQuote });
          else {
            body = reject(reasons);
            actor = "agent";
          }
          break;
        }
        case "PIX": {
          const pix = { amountCents: result.amountCents, evidence: result.evidence, detectedAt: this.now().toISOString(), ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}), ...(result.payloadDigest && /^[a-f0-9]{64}$/.test(result.payloadDigest) ? { payloadDigest: result.payloadDigest } : {}) };
          const reasons = checkPix(run, pix, this.now());
          body = reasons.length ? eventBody("RUN_FAILED", { code: "pix_mismatch", reason: reasons.join("; ") }) : eventBody("PIX_DETECTED", { pix });
          if (reasons.length) actor = "agent";
          break;
        }
        case "ORDER":
          body = result.confirmed ? eventBody("ORDER_CONFIRMED", { evidence: result.evidence.slice(0, 120) }) : eventBody("BROWSER_NEEDS_USER", { commandId: pending.commandId, reason: "order confirmation is not visible yet" });
          break;
        case "UNAVAILABLE":
          if (pending.type === "REVALIDATE_CANDIDATE" || pending.type === "PREPARE_CHECKOUT" || pending.type === "READ_CHECKOUT") body = reject([`unavailable: ${result.reason.slice(0, 200)}`]);
          else if (pending.type === "VERIFY_ORDER") body = eventBody("BROWSER_NEEDS_USER", { commandId: pending.commandId, reason: result.reason.slice(0, 200) });
          else body = eventBody("RUN_FAILED", { code: "pix_unavailable", reason: result.reason.slice(0, 200) });
          actor = "agent";
          break;
        case "ERROR":
          body = pending.type === "REVALIDATE_CANDIDATE" ? reject([`browser error: ${result.reason.slice(0, 200)}`]) : eventBody("RUN_FAILED", { code: "browser_error", reason: result.reason.slice(0, 200) });
          actor = "agent";
          break;
      }
      const appended = await this.append(run, body, actor);
      if (!appended.ok) throw new RuntimeError(422, appended.error);
      return this.advanceUnlocked(runId);
    });
  }

  async walletState(
    runId: string,
    input: { connected: boolean; address?: string; shieldedUsdc?: string; publicUsdc?: string; solLamports?: string }
  ): Promise<AgentRun> {
    return this.withLock(runId, async () => {
      const { run } = await this.load(runId);
      if (!input.connected) {
        const r = await this.append(run, eventBody("WALLET_DISCONNECTED", {}), "wallet");
        if (!r.ok) throw new RuntimeError(422, r.error);
        return this.advanceUnlocked(runId);
      }
      if (!input.address || !isSolanaAddress(input.address)) throw new RuntimeError(400, "address must be a Solana address");
      for (const [k, v] of [["shieldedUsdc", input.shieldedUsdc], ["publicUsdc", input.publicUsdc], ["solLamports", input.solLamports]] as const) {
        if (v !== undefined && !/^\d{1,20}$/.test(v)) throw new RuntimeError(400, `${k} must be an integer string (base units)`);
      }
      if (!this.deps.chain && input.publicUsdc !== undefined) {
        this.lastPublicReport.set(runId, { publicUsdc: BigInt(input.publicUsdc), solLamports: BigInt(input.solLamports ?? "0") });
      }
      const r = await this.append(
        run,
        eventBody("WALLET_CONNECTED", { address: input.address, ...(input.shieldedUsdc !== undefined ? { shieldedUsdc: input.shieldedUsdc, reportedAt: this.now().toISOString() } : {}) }),
        "wallet"
      );
      if (!r.ok) throw new RuntimeError(422, r.error);
      return this.advanceUnlocked(runId);
    });
  }

  async confirm(runId: string, input: { digest: string; amountCents: number } | { reject: true; reason?: string }): Promise<AgentRun> {
    return this.withLock(runId, async () => {
      const { run } = await this.load(runId);
      const body =
        "reject" in input
          ? eventBody("USER_REJECTED", input.reason ? { reason: input.reason.slice(0, 200) } : {})
          : eventBody("USER_CONFIRMED", { digest: input.digest, amountCents: input.amountCents as never });
      const r = await this.append(run, body, "user");
      if (!r.ok) throw new RuntimeError(409, r.error);
      return this.advanceUnlocked(runId);
    });
  }

  /** The wallet signed and sent the private withdrawal; the runtime verifies settlement. */
  async paymentSubmitted(runId: string, input: { signature: string }): Promise<AgentRun> {
    return this.withLock(runId, async () => {
      const { run } = await this.load(runId);
      const r = await this.append(run, eventBody("PAYMENT_SUBMITTED", { signature: input.signature }), "wallet");
      if (!r.ok) throw new RuntimeError(409, r.error);
      const attempt = await this.deps.store.getPaymentAttempt(runId);
      if (attempt) await this.deps.store.upsertPaymentAttempt({ ...attempt, signature: input.signature, status: "submitted", updatedAt: this.now().toISOString() });
      return this.advanceUnlocked(runId);
    });
  }
}

/** Re-validates a CartQuote from the browser through the observation allowlist (drops unexpected fields). */
function sanitizeQuote(quote: unknown, capturedAt: string): CartQuote | null {
  const result = sanitizeObservation({
    id: "executor-quote",
    kind: "cart-quote",
    source: (quote as { source?: unknown } | null)?.source,
    observedAt: capturedAt,
    context: { membership: "unknown", promotionScope: "unknown" },
    provenance: { method: "browser-extension", live: true, synthetic: false },
    quote
  });
  return result.ok && result.observation.kind === "cart-quote" ? result.observation.quote : null;
}
