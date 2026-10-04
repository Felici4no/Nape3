import { formatBRL } from "@nape3/domain";
import { assessFunding, DEFAULT_FUNDING_POLICY, type FundingPolicy, type FundingRequirement, type WalletFunds } from "../funding";
import type { RunEvent, WireFunds, WireFundingPolicy, WireRequirement } from "./events";
import { checkAuthorization, checkExecutorQuote, checkPix, confirmationDigest } from "./invariants";
import type { AgentRun, PaymentState, RunPolicy, RunState } from "./types";
import { DEFAULT_RUN_POLICY, FUNDING_STATES, TERMINAL_STATES } from "./types";

/**
 * Event log → run. `applyRunEvent` is the only way a run changes, and it
 * refuses any event that breaks an execution invariant, so an invalid event
 * never enters the log (the runtime applies before it appends).
 */

export type ApplyResult = { ok: true; run: AgentRun } | { ok: false; error: string };

const BIGINT = /^\d+$/;

function big(value: string, field: string): bigint {
  if (!BIGINT.test(value)) throw new RangeError(`${field} must be a non-negative integer string`);
  return BigInt(value);
}

export function fundsFromWire(w: WireFunds): WalletFunds {
  return {
    address: w.address,
    publicUsdc: big(w.publicUsdc, "publicUsdc"),
    shieldedUsdc: big(w.shieldedUsdc, "shieldedUsdc"),
    solLamports: big(w.solLamports, "solLamports"),
    checkedAt: w.checkedAt
  };
}

export function fundsToWire(f: WalletFunds): WireFunds {
  return {
    address: f.address,
    publicUsdc: f.publicUsdc.toString(),
    shieldedUsdc: f.shieldedUsdc.toString(),
    solLamports: f.solLamports.toString(),
    checkedAt: f.checkedAt
  };
}

export function requirementFromWire(w: WireRequirement): FundingRequirement {
  return {
    checkoutTotalCents: w.checkoutTotalCents,
    offrampNetUsdc: big(w.offrampNetUsdc, "offrampNetUsdc"),
    cloakFeeUsdc: big(w.cloakFeeUsdc, "cloakFeeUsdc"),
    grossUsdc: big(w.grossUsdc, "grossUsdc"),
    destination: w.destination,
    quoteSimulated: w.quoteSimulated
  };
}

export function requirementToWire(r: FundingRequirement): WireRequirement {
  return {
    checkoutTotalCents: r.checkoutTotalCents,
    offrampNetUsdc: r.offrampNetUsdc.toString(),
    cloakFeeUsdc: r.cloakFeeUsdc.toString(),
    grossUsdc: r.grossUsdc.toString(),
    destination: r.destination,
    quoteSimulated: r.quoteSimulated
  };
}

function policyFromWire(w: WireFundingPolicy | undefined): FundingPolicy {
  if (!w) return DEFAULT_FUNDING_POLICY;
  return { minShieldUsdc: big(w.minShieldUsdc, "minShieldUsdc"), minSolForShieldLamports: big(w.minSolForShieldLamports, "minSolForShieldLamports") };
}

/** Payment fields kept when the checkout is invalidated: who the wallet is, nothing about funds or consent. */
function walletOnly(payment: PaymentState): PaymentState {
  return {
    ...(payment.walletAddress ? { walletAddress: payment.walletAddress } : {}),
    ...(payment.walletReport ? { walletReport: payment.walletReport } : {})
  };
}

const PRE_AUTHORIZATION: readonly RunState[] = [
  "INTENT_CAPTURED",
  "MARKET_SEARCH",
  "CANDIDATES_NORMALIZED",
  "BEST_OPTION_SELECTED",
  "REVALIDATION_REQUESTED",
  "REVALIDATING",
  "QUOTE_VALIDATED",
  "CHECKOUT_PREPARED",
  ...FUNDING_STATES
];

const CANDIDATE_REJECTABLE: readonly RunState[] = ["BEST_OPTION_SELECTED", "REVALIDATION_REQUESTED", "REVALIDATING", "QUOTE_VALIDATED", "CHECKOUT_PREPARED"];

export function applyRunEvent(run: AgentRun | null, event: RunEvent, policy: RunPolicy = DEFAULT_RUN_POLICY): ApplyResult {
  try {
    return apply(run, event, policy);
  } catch (error) {
    return { ok: false, error: `${event.type}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

function apply(run: AgentRun | null, event: RunEvent, policy: RunPolicy): ApplyResult {
  const fail = (error: string): ApplyResult => ({ ok: false, error: `${event.type}: ${error}` });
  const now = new Date(event.at);
  if (Number.isNaN(now.getTime())) return fail("invalid timestamp");

  if (event.type === "INTENT_CREATED") {
    if (run) return fail("run already exists");
    if (event.seq !== 1) return fail("INTENT_CREATED must be the first event");
    const p = event.payload;
    return {
      ok: true,
      run: {
        id: event.runId,
        ...(p.userId ? { userId: p.userId } : {}),
        executorId: p.executorId,
        executionMode: p.executionMode,
        state: "INTENT_CAPTURED",
        intent: p.intent,
        requirement: p.requirement,
        candidates: [],
        rejectedCandidates: [],
        payment: {},
        warnings: [],
        createdAt: event.at,
        updatedAt: event.at,
        version: 1
      }
    };
  }

  if (!run) return fail("run does not exist");
  if (event.runId !== run.id) return fail("event belongs to another run");
  if (event.seq !== run.version + 1) return fail(`expected seq ${run.version + 1}, got ${event.seq}`);
  if (TERMINAL_STATES.includes(run.state)) return fail(`run is ${run.state}`);

  const to = (state: RunState, patch: Partial<AgentRun> = {}): ApplyResult => ({
    ok: true,
    run: { ...run, ...patch, state, updatedAt: event.at, version: event.seq }
  });
  const stay = (patch: Partial<AgentRun> = {}) => to(run.state, patch);
  const inState = (...states: RunState[]) => states.includes(run.state);
  const pending = run.pendingCommand;

  switch (event.type) {
    case "MARKET_SEARCH_STARTED":
      return inState("INTENT_CAPTURED") ? to("MARKET_SEARCH") : fail(`not allowed from ${run.state}`);

    case "MARKET_SEARCHED": {
      if (!inState("INTENT_CAPTURED", "MARKET_SEARCH")) return fail(`not allowed from ${run.state}`);
      const candidates = event.payload.candidates.slice(0, policy.maxCandidates);
      return to(candidates.length > 0 ? "CANDIDATES_NORMALIZED" : "NO_VALID_OPTION", { candidates });
    }

    case "CANDIDATE_SELECTED": {
      if (!inState("CANDIDATES_NORMALIZED")) return fail(`not allowed from ${run.state}`);
      const candidate = run.candidates.find((c) => c.candidateId === event.payload.candidateId);
      if (!candidate) return fail("unknown candidate");
      if (run.rejectedCandidates.some((r) => r.candidateId === candidate.candidateId)) return fail("candidate was already rejected");
      const { validatedQuote: _v, checkout: _c, ...rest } = run;
      return { ok: true, run: { ...rest, selectedCandidate: candidate, state: "BEST_OPTION_SELECTED", updatedAt: event.at, version: event.seq } };
    }

    case "REVALIDATION_REQUESTED": {
      const command = event.payload.command;
      if (!inState("BEST_OPTION_SELECTED")) return fail(`not allowed from ${run.state}`);
      if (command.type !== "REVALIDATE_CANDIDATE" || command.runId !== run.id) return fail("expected a REVALIDATE_CANDIDATE command for this run");
      if (command.candidate.candidateId !== run.selectedCandidate?.candidateId) return fail("command is for a different candidate");
      return to("REVALIDATION_REQUESTED", { pendingCommand: command });
    }

    case "REVALIDATION_STARTED":
      if (!inState("REVALIDATION_REQUESTED", "REVALIDATING") || pending?.commandId !== event.payload.commandId) return fail("no matching pending revalidation");
      return to("REVALIDATING");

    case "BROWSER_NEEDS_USER":
      if (pending?.commandId !== event.payload.commandId) return fail("no matching pending command");
      return stay({ waitingOnUser: event.payload.reason });

    case "QUOTE_VALIDATED": {
      if (!inState("REVALIDATION_REQUESTED", "REVALIDATING")) return fail(`not allowed from ${run.state}`);
      const quote = event.payload.quote;
      if (pending?.type !== "REVALIDATE_CANDIDATE" || quote.commandId !== pending.commandId) return fail("quote does not answer the pending revalidation");
      const reasons = checkExecutorQuote(run, quote, "revalidation", now, policy);
      if (reasons.length) return fail(reasons.join("; "));
      const { pendingCommand: _p, waitingOnUser: _w, ...rest } = run;
      return { ok: true, run: { ...rest, validatedQuote: quote, state: "QUOTE_VALIDATED", updatedAt: event.at, version: event.seq } };
    }

    case "CANDIDATE_REJECTED": {
      if (!inState(...CANDIDATE_REJECTABLE)) return fail(`not allowed from ${run.state}`);
      if (event.payload.candidateId !== run.selectedCandidate?.candidateId) return fail("only the selected candidate can be rejected");
      const rejectedCandidates = [...run.rejectedCandidates, { candidateId: event.payload.candidateId, reasons: event.payload.reasons }];
      const rejected = new Set(rejectedCandidates.map((r) => r.candidateId));
      const remaining = run.candidates.filter((c) => !rejected.has(c.candidateId));
      const { pendingCommand: _p, waitingOnUser: _w, selectedCandidate: _s, validatedQuote: _v, checkout: _c, recheckout: _r, ...rest } = run;
      const next: RunState = remaining.length > 0 && rejectedCandidates.length < policy.maxCandidates ? "CANDIDATES_NORMALIZED" : "NO_VALID_OPTION";
      return { ok: true, run: { ...rest, rejectedCandidates, payment: walletOnly(run.payment), state: next, updatedAt: event.at, version: event.seq } };
    }

    case "CHECKOUT_REQUESTED": {
      const command = event.payload.command;
      if (!inState("QUOTE_VALIDATED") || pending) return fail(`not allowed from ${run.state}`);
      if ((command.type !== "PREPARE_CHECKOUT" && command.type !== "READ_CHECKOUT") || command.runId !== run.id) return fail("expected a checkout command");
      return stay({ pendingCommand: command });
    }

    case "CHECKOUT_READY": {
      if (!inState("QUOTE_VALIDATED")) return fail(`not allowed from ${run.state}`);
      const quote = event.payload.quote;
      if ((pending?.type !== "PREPARE_CHECKOUT" && pending?.type !== "READ_CHECKOUT") || quote.commandId !== pending.commandId) {
        return fail("quote does not answer the pending checkout command");
      }
      const reasons = checkExecutorQuote(run, quote, "checkout", now, policy);
      if (reasons.length) return fail(reasons.join("; "));
      const { pendingCommand: _p, waitingOnUser: _w, recheckout: _r, ...rest } = run;
      return { ok: true, run: { ...rest, checkout: { quote }, state: "CHECKOUT_PREPARED", updatedAt: event.at, version: event.seq } };
    }

    case "CHECKOUT_INVALIDATED": {
      if (!inState("CHECKOUT_PREPARED", ...FUNDING_STATES, "PAYMENT_AUTHORIZED")) return fail(`not allowed from ${run.state}`);
      const { pendingCommand: _p, waitingOnUser: _w, checkout: _c, ...rest } = run;
      return {
        ok: true,
        run: {
          ...rest,
          payment: walletOnly(run.payment),
          recheckout: true,
          warnings: [...run.warnings, `checkout must be read again: ${event.payload.reason}`],
          state: "QUOTE_VALIDATED",
          updatedAt: event.at,
          version: event.seq
        }
      };
    }

    case "PIX_REQUESTED": {
      const command = event.payload.command;
      if (!inState("CHECKOUT_PREPARED") || pending) return fail(`not allowed from ${run.state}`);
      if (command.type !== "READ_PIX" || command.runId !== run.id) return fail("expected a READ_PIX command");
      if (command.expectedAmountCents !== run.checkout!.quote.quote.totalCents) return fail("expected amount differs from the checkout total");
      return stay({ pendingCommand: command });
    }

    case "PIX_DETECTED": {
      if (!inState("CHECKOUT_PREPARED") || pending?.type !== "READ_PIX") return fail("no pending READ_PIX");
      const reasons = checkPix(run, event.payload.pix, now);
      if (reasons.length) return fail(reasons.join("; "));
      const { pendingCommand: _p, waitingOnUser: _w, ...rest } = run;
      return { ok: true, run: { ...rest, checkout: { ...run.checkout!, pix: event.payload.pix }, state: "PIX_DETECTED", updatedAt: event.at, version: event.seq } };
    }

    case "WALLET_CONNECTED": {
      const { address } = event.payload;
      if (!address) return fail("address is required");
      const report =
        event.payload.shieldedUsdc !== undefined
          ? { address, shieldedUsdc: big(event.payload.shieldedUsdc, "shieldedUsdc"), at: event.payload.reportedAt ?? event.at }
          : run.payment.walletReport?.address === address
            ? run.payment.walletReport
            : undefined;
      const previous = run.payment.walletAddress ?? run.payment.lastWalletAddress;
      const changed = previous !== undefined && previous !== address;
      const withWallet = (payment: PaymentState): PaymentState => ({ ...payment, walletAddress: address, ...(report ? { walletReport: report } : {}), lastWalletAddress: address });

      if (inState("SETTLING", "SETTLED")) {
        return changed ? stay({ warnings: [...run.warnings, "wallet changed after the payment was submitted; ignored for this run"] }) : stay();
      }
      if (changed && run.checkout && inState("PIX_DETECTED", "WALLET_REQUIRED", "WALLET_CONNECTED", "FUNDS_CHECKED", "SHIELD_REQUIRED", "PAYMENT_READY", "USER_CONFIRMATION", "PAYMENT_AUTHORIZED")) {
        // A different wallet: nothing it was told or agreed to carries over. Re-read the checkout, check funds, confirm again.
        const { pendingCommand: _p, checkout: _c, ...rest } = run;
        return {
          ok: true,
          run: {
            ...rest,
            payment: withWallet({}),
            recheckout: true,
            warnings: [...run.warnings, "wallet changed: checkout, funds and confirmation must be redone"],
            state: "QUOTE_VALIDATED",
            updatedAt: event.at,
            version: event.seq
          }
        };
      }
      if (inState("PIX_DETECTED", "WALLET_REQUIRED")) return to("WALLET_CONNECTED", { payment: withWallet(run.payment) });
      return stay({ payment: withWallet(run.payment) });
    }

    case "WALLET_REQUIRED":
      if (!inState("PIX_DETECTED")) return fail(`not allowed from ${run.state}`);
      if (run.payment.walletAddress) return fail("a wallet is already connected");
      return to("WALLET_REQUIRED");

    case "WALLET_DISCONNECTED": {
      if (inState("SETTLING", "SETTLED")) return stay();
      const payment: PaymentState = run.payment.lastWalletAddress ? { lastWalletAddress: run.payment.lastWalletAddress } : {};
      if (inState("WALLET_CONNECTED", "FUNDS_CHECKED", "SHIELD_REQUIRED", "PAYMENT_READY", "USER_CONFIRMATION", "PAYMENT_AUTHORIZED")) {
        return to("WALLET_REQUIRED", { payment });
      }
      return stay({ payment });
    }

    case "FUNDS_CHECKED": {
      if (!inState("WALLET_CONNECTED", "FUNDS_CHECKED", "SHIELD_REQUIRED", "PAYMENT_READY")) return fail(`not allowed from ${run.state}`);
      const funds = fundsFromWire(event.payload.funds);
      const requirement = requirementFromWire(event.payload.requirement);
      if (funds.address !== run.payment.walletAddress) return fail("funds belong to a different wallet than the one connected");
      if (requirement.checkoutTotalCents !== run.checkout?.pix?.amountCents) return fail("funding requirement does not match the payment target");
      if (requirement.grossUsdc < requirement.offrampNetUsdc) return fail("gross amount is below the off-ramp amount");
      const assessment = assessFunding(requirement, funds, policyFromWire(event.payload.policy));
      const { confirmationRequest: _r, confirmation: _c, ...payment } = run.payment;
      return to("FUNDS_CHECKED", { payment: { ...payment, funds, requirement, assessment, fundsVerified: event.payload.verified } });
    }

    case "SHIELD_REQUIRED":
      if (!inState("FUNDS_CHECKED") || run.payment.assessment?.kind !== "shield-required") return fail("funds are not short");
      return to("SHIELD_REQUIRED");

    case "PAYMENT_READY":
      if (!inState("FUNDS_CHECKED") || run.payment.assessment?.kind !== "ready") return fail("shielded funds are not sufficient");
      return to("PAYMENT_READY");

    case "CONFIRMATION_REQUESTED": {
      if (!inState("PAYMENT_READY")) return fail(`not allowed from ${run.state}`);
      const r = event.payload.request;
      const pix = run.checkout?.pix;
      const req = run.payment.requirement;
      if (!pix || !req || !run.selectedCandidate || !run.payment.walletAddress) return fail("payment is not ready");
      const grossUsdc = big(r.grossUsdc, "grossUsdc");
      const expected = confirmationDigest({
        runId: run.id,
        amountCents: pix.amountCents,
        grossUsdc: req.grossUsdc,
        walletAddress: run.payment.walletAddress,
        candidateId: run.selectedCandidate.candidateId,
        checkoutCapturedAt: run.checkout!.quote.capturedAt
      });
      if (r.digest !== expected || r.amountCents !== pix.amountCents || grossUsdc !== req.grossUsdc || r.walletAddress !== run.payment.walletAddress) {
        return fail("confirmation terms do not match the payment");
      }
      if (Date.parse(r.expiresAt) <= now.getTime()) return fail("confirmation request is already expired");
      return to("USER_CONFIRMATION", {
        payment: {
          ...run.payment,
          confirmationRequest: {
            amountCents: r.amountCents,
            grossUsdc,
            walletAddress: r.walletAddress,
            candidateId: r.candidateId,
            checkoutCapturedAt: r.checkoutCapturedAt,
            expiresAt: r.expiresAt,
            digest: r.digest
          }
        }
      });
    }

    case "USER_CONFIRMED": {
      const request = run.payment.confirmationRequest;
      if (!inState("USER_CONFIRMATION") || !request) return fail("nothing to confirm");
      if (event.actor !== "user") return fail("only the user can confirm");
      if (event.payload.digest !== request.digest) return fail("confirmation does not match the terms shown");
      if (event.payload.amountCents !== request.amountCents) {
        return fail(`confirmed ${formatBRL(event.payload.amountCents)}, terms say ${formatBRL(request.amountCents)}`);
      }
      if (Date.parse(request.expiresAt) <= now.getTime()) return fail("confirmation request has expired");
      return stay({ payment: { ...run.payment, confirmation: { digest: event.payload.digest, amountCents: event.payload.amountCents, at: event.at } } });
    }

    case "USER_REJECTED":
      if (!inState(...PRE_AUTHORIZATION, "PAYMENT_AUTHORIZED")) return fail(`not allowed from ${run.state}`);
      if (event.actor !== "user") return fail("only the user can reject");
      return to("CANCELLED", { warnings: [...run.warnings, `cancelled by the user${event.payload.reason ? `: ${event.payload.reason}` : ""}; nothing was charged`] });

    case "PAYMENT_AUTHORIZED": {
      const reasons = checkAuthorization(run, event.payload.amountCents, event.payload.basis, now, policy);
      if (reasons.length) return fail(reasons.join("; "));
      return to("PAYMENT_AUTHORIZED", { payment: { ...run.payment, authorization: { amountCents: event.payload.amountCents, basis: event.payload.basis, at: event.at } } });
    }

    case "PAYMENT_SUBMITTED":
      if (!inState("PAYMENT_AUTHORIZED")) return fail(`not allowed from ${run.state}`);
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,100}$/.test(event.payload.signature)) return fail("signature is not a base58 transaction signature");
      return to("SETTLING", { payment: { ...run.payment, signature: event.payload.signature } });

    case "SETTLEMENT_VERIFIED":
      if (!inState("SETTLING")) return fail(`not allowed from ${run.state}`);
      if (event.payload.signature !== run.payment.signature) return fail("signature does not match the submitted payment");
      if (event.payload.simulated !== (run.executionMode === "simulated")) return fail("settlement mode does not match the run's execution mode");
      return to("SETTLED", { payment: { ...run.payment, settlementReference: event.payload.reference } });

    case "SETTLEMENT_FAILED":
      if (!inState("SETTLING")) return fail(`not allowed from ${run.state}`);
      return to("SETTLEMENT_FAILED", { payment: { ...run.payment, settlementFailure: event.payload.reason } });

    case "ORDER_REQUESTED": {
      const command = event.payload.command;
      if (!inState("SETTLED") || pending) return fail(`not allowed from ${run.state}`);
      if (command.type !== "VERIFY_ORDER" || command.runId !== run.id) return fail("expected a VERIFY_ORDER command");
      return stay({ pendingCommand: command });
    }

    case "ORDER_CONFIRMED": {
      if (!inState("SETTLED") || pending?.type !== "VERIFY_ORDER") return fail("no pending VERIFY_ORDER");
      const { pendingCommand: _p, waitingOnUser: _w, ...rest } = run;
      return { ok: true, run: { ...rest, order: { evidence: event.payload.evidence, at: event.at }, state: "ORDER_CONFIRMED", updatedAt: event.at, version: event.seq } };
    }

    case "RUN_FAILED":
      return to("FAILED", { failure: { code: event.payload.code, reason: event.payload.reason } });
  }
  return fail("unknown event");
}

/** Folds a full log. Throws if the log is invalid (it never should be: events are applied before they are stored). */
export function reduceRun(events: readonly RunEvent[], policy: RunPolicy = DEFAULT_RUN_POLICY): AgentRun {
  let run: AgentRun | null = null;
  for (const event of events) {
    const result = applyRunEvent(run, event, policy);
    if (!result.ok) throw new Error(`invalid event log at seq ${event.seq}: ${result.error}`);
    run = result.run;
  }
  if (!run) throw new Error("empty event log");
  return run;
}
