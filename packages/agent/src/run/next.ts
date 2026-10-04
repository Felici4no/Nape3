import type { AgentBrowserCommand } from "./protocol";
import { minutesBetween, quoteIsFresh } from "./invariants";
import type { AgentRun, CandidateRef, RunPolicy } from "./types";
import { DEFAULT_RUN_POLICY, TERMINAL_STATES } from "./types";

/**
 * What should happen next for a run. Pure: the runtime performs "agent"
 * actions itself and waits on the others (browser, wallet, user, chain).
 */
export type AgentAction =
  | { kind: "SEARCH_MARKET" }
  | { kind: "SELECT_CANDIDATE"; candidate: CandidateRef }
  | { kind: "SEND_COMMAND"; command: AgentBrowserCommand }
  | { kind: "AWAIT_BROWSER"; command: AgentBrowserCommand; waitingOnUser?: string }
  | { kind: "INVALIDATE_CHECKOUT"; reason: string }
  | { kind: "REQUIRE_WALLET" }
  | { kind: "REUSE_WALLET"; address: string }
  | { kind: "AWAIT_WALLET" }
  | { kind: "AWAIT_WALLET_REPORT"; address: string }
  | { kind: "CHECK_FUNDS"; address: string; shieldedUsdc: bigint }
  | { kind: "EVALUATE_FUNDS"; ready: boolean }
  | { kind: "AWAIT_SHIELD"; shieldAmountUsdc: bigint }
  | { kind: "REQUEST_CONFIRMATION" }
  | { kind: "AWAIT_CONFIRMATION" }
  | { kind: "AUTHORIZE" }
  | { kind: "AWAIT_PAYMENT_SUBMISSION" }
  | { kind: "VERIFY_SETTLEMENT"; signature: string }
  | { kind: "DONE"; outcome: AgentRun["state"] };

/** Who has to act for the run to progress. */
export function actionOwner(action: AgentAction): "agent" | "browser" | "wallet" | "user" | "none" {
  switch (action.kind) {
    case "AWAIT_BROWSER":
      return "browser";
    case "AWAIT_WALLET":
    case "AWAIT_WALLET_REPORT":
    case "AWAIT_SHIELD":
    case "AWAIT_PAYMENT_SUBMISSION":
      return "wallet";
    case "AWAIT_CONFIRMATION":
      return "user";
    case "DONE":
      return "none";
    default:
      return "agent";
  }
}

/** A wallet report (shielded balance) is usable for this long. */
export const WALLET_REPORT_TTL_MINUTES = 5;

function commandId(run: AgentRun): string {
  return `${run.id}:c${run.version + 1}`;
}

export function nextAction(run: AgentRun, now: Date, policy: RunPolicy = DEFAULT_RUN_POLICY): AgentAction {
  if (TERMINAL_STATES.includes(run.state)) return { kind: "DONE", outcome: run.state };
  const pending = run.pendingCommand;
  const awaitBrowser = (): AgentAction => ({ kind: "AWAIT_BROWSER", command: pending!, ...(run.waitingOnUser ? { waitingOnUser: run.waitingOnUser } : {}) });
  const checkoutStale = run.checkout && !quoteIsFresh(run.checkout.quote, now, policy);
  const report = run.payment.walletReport;
  const reportUsable =
    report && report.address === run.payment.walletAddress && minutesBetween(report.at, now) <= WALLET_REPORT_TTL_MINUTES;

  switch (run.state) {
    case "INTENT_CAPTURED":
    case "MARKET_SEARCH":
      return { kind: "SEARCH_MARKET" };

    case "CANDIDATES_NORMALIZED": {
      const rejected = new Set(run.rejectedCandidates.map((r) => r.candidateId));
      const candidate = run.candidates.find((c) => !rejected.has(c.candidateId));
      // The reducer moves to NO_VALID_OPTION when none is left, so one always exists here.
      return { kind: "SELECT_CANDIDATE", candidate: candidate! };
    }

    case "BEST_OPTION_SELECTED": {
      const c = run.selectedCandidate!;
      return {
        kind: "SEND_COMMAND",
        command: {
          type: "REVALIDATE_CANDIDATE",
          commandId: commandId(run),
          runId: run.id,
          candidate: {
            candidateId: c.candidateId,
            source: c.source,
            merchantName: c.merchantName,
            requirement: run.requirement,
            quantity: run.intent.product.quantity,
            observedTotalCents: c.observedTotalCents
          }
        }
      };
    }

    case "REVALIDATION_REQUESTED":
    case "REVALIDATING":
      return awaitBrowser();

    case "QUOTE_VALIDATED": {
      if (pending) return awaitBrowser();
      // First time: navigate to and prepare the checkout. After an invalidation: read it again.
      return { kind: "SEND_COMMAND", command: { type: run.recheckout ? "READ_CHECKOUT" : "PREPARE_CHECKOUT", commandId: commandId(run), runId: run.id } };
    }

    case "CHECKOUT_PREPARED":
      if (pending) return awaitBrowser();
      if (checkoutStale) return { kind: "INVALIDATE_CHECKOUT", reason: "checkout quote went stale" };
      return {
        kind: "SEND_COMMAND",
        command: { type: "READ_PIX", commandId: commandId(run), runId: run.id, expectedAmountCents: run.checkout!.quote.quote.totalCents }
      };

    case "PIX_DETECTED":
      return run.payment.walletAddress ? { kind: "REUSE_WALLET", address: run.payment.walletAddress } : { kind: "REQUIRE_WALLET" };

    case "WALLET_REQUIRED":
      return { kind: "AWAIT_WALLET" };

    case "WALLET_CONNECTED":
      return reportUsable
        ? { kind: "CHECK_FUNDS", address: report!.address, shieldedUsdc: report!.shieldedUsdc }
        : { kind: "AWAIT_WALLET_REPORT", address: run.payment.walletAddress! };

    case "FUNDS_CHECKED":
      return { kind: "EVALUATE_FUNDS", ready: run.payment.assessment?.kind === "ready" };

    case "SHIELD_REQUIRED": {
      const assessment = run.payment.assessment;
      const fresher = report && run.payment.funds && Date.parse(report.at) > Date.parse(run.payment.funds.checkedAt);
      if (reportUsable && fresher) return { kind: "CHECK_FUNDS", address: report!.address, shieldedUsdc: report!.shieldedUsdc };
      return { kind: "AWAIT_SHIELD", shieldAmountUsdc: assessment?.kind === "shield-required" ? assessment.shieldAmountUsdc : 0n };
    }

    case "PAYMENT_READY":
      if (checkoutStale) return { kind: "INVALIDATE_CHECKOUT", reason: "checkout quote went stale before confirmation" };
      return { kind: "REQUEST_CONFIRMATION" };

    case "USER_CONFIRMATION": {
      const request = run.payment.confirmationRequest!;
      if (checkoutStale) return { kind: "INVALIDATE_CHECKOUT", reason: "checkout quote went stale before authorization" };
      if (Date.parse(request.expiresAt) <= now.getTime()) return { kind: "INVALIDATE_CHECKOUT", reason: "confirmation request expired" };
      return run.payment.confirmation ? { kind: "AUTHORIZE" } : { kind: "AWAIT_CONFIRMATION" };
    }

    case "PAYMENT_AUTHORIZED":
      return { kind: "AWAIT_PAYMENT_SUBMISSION" };

    case "SETTLING":
      return { kind: "VERIFY_SETTLEMENT", signature: run.payment.signature! };

    case "SETTLED":
      if (pending) return awaitBrowser();
      return { kind: "SEND_COMMAND", command: { type: "VERIFY_ORDER", commandId: commandId(run), runId: run.id } };
  }
  return { kind: "DONE", outcome: run.state };
}
