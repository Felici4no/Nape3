import { formatBRL, quoteMatchesRequirement, verifyCartQuote, type Cents } from "@nape3/domain";
import type { AuthorizationBasis, AgentRun, ExecutorQuote, PixTarget, RunPolicy } from "./types";
import { DEFAULT_RUN_POLICY } from "./types";

/**
 * Execution invariants. Pure functions returning the list of violated rules
 * (empty = allowed). The reducer calls them, so a violating event can never
 * enter the log, whatever the caller does.
 */

const CLOCK_SKEW_MS = 2 * 60_000;

export function normalizeMerchant(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function minutesBetween(fromIso: string, now: Date): number {
  return (now.getTime() - Date.parse(fromIso)) / 60_000;
}

export function quoteIsFresh(quote: ExecutorQuote, now: Date, policy: RunPolicy = DEFAULT_RUN_POLICY): boolean {
  const age = minutesBetween(quote.capturedAt, now);
  return Number.isFinite(age) && age <= policy.quoteTtlMinutes && age >= -CLOCK_SKEW_MS / 60_000;
}

function withinDrift(total: number, reference: number, bps: number): boolean {
  return total * 10_000 <= reference * (10_000 + bps);
}

/**
 * A quote read by the browser executor, for revalidating the selected
 * candidate ("revalidation") or at checkout ("checkout").
 */
export function checkExecutorQuote(
  run: AgentRun,
  executorQuote: ExecutorQuote,
  stage: "revalidation" | "checkout",
  now: Date,
  policy: RunPolicy = DEFAULT_RUN_POLICY
): string[] {
  const reasons: string[] = [];
  const { quote } = executorQuote;
  const candidate = run.selectedCandidate;
  if (!candidate) return ["no candidate is selected"];

  if (executorQuote.executorId !== run.executorId) reasons.push("quote was not read by this run's browser executor");

  const consistency = verifyCartQuote(quote);
  if (!consistency.consistent) reasons.push(`quote does not reconcile: ${consistency.issues.join("; ")}`);

  const match = quoteMatchesRequirement(quote, run.requirement, run.intent.product.quantity);
  if (!match.comparable) reasons.push(`quote is not the requested product: ${match.reasons.join("; ")}`);

  if (quote.source !== candidate.source) reasons.push(`quote is from ${quote.source}, candidate is on ${candidate.source}`);
  if (normalizeMerchant(quote.merchant.name) !== normalizeMerchant(candidate.merchantName)) {
    reasons.push(`quote is from "${quote.merchant.name}", candidate is "${candidate.merchantName}"`);
  }

  if (!quoteIsFresh(executorQuote, now, policy)) reasons.push(`quote is stale or mis-dated (captured ${executorQuote.capturedAt})`);

  const max = run.intent.budget.maxCents;
  if (max !== undefined && quote.totalCents > max) {
    reasons.push(`total ${formatBRL(quote.totalCents)} is above the budget of ${formatBRL(max)}`);
  }

  if (stage === "revalidation") {
    if (!withinDrift(quote.totalCents, candidate.observedTotalCents, policy.maxPriceDriftBps)) {
      reasons.push(
        `total ${formatBRL(quote.totalCents)} is more than ${policy.maxPriceDriftBps / 100}% above the observed ${formatBRL(candidate.observedTotalCents)}`
      );
    }
  } else {
    if (quote.stage !== "checkout" && quote.stage !== "pix-payment") reasons.push(`expected a checkout, got a ${quote.stage} quote`);
    const validated = run.validatedQuote?.quote.totalCents;
    if (validated === undefined) reasons.push("no revalidated quote to compare the checkout with");
    else if (!withinDrift(quote.totalCents, validated, policy.maxPriceDriftBps)) {
      reasons.push(`checkout ${formatBRL(quote.totalCents)} is more than ${policy.maxPriceDriftBps / 100}% above the revalidated ${formatBRL(validated)}`);
    }
  }
  return reasons;
}

export function checkPix(run: AgentRun, pix: PixTarget, now: Date): string[] {
  const reasons: string[] = [];
  const total = run.checkout?.quote.quote.totalCents;
  if (total === undefined) return ["no checkout to match the Pix against"];
  if (pix.amountCents !== total) reasons.push(`Pix amount ${formatBRL(pix.amountCents)} differs from the checkout total ${formatBRL(total)}`);
  if (pix.expiresAt && Date.parse(pix.expiresAt) <= now.getTime()) reasons.push("Pix has already expired");
  return reasons;
}

export function confirmationDigest(fields: {
  runId: string;
  amountCents: Cents;
  grossUsdc: bigint;
  walletAddress: string;
  candidateId: string;
  checkoutCapturedAt: string;
}): string {
  return [
    "u3-confirm-v1",
    fields.runId,
    fields.amountCents,
    fields.grossUsdc.toString(),
    fields.walletAddress,
    fields.candidateId,
    fields.checkoutCapturedAt
  ].join("|");
}

/** Everything that must hold to move USER_CONFIRMATION → PAYMENT_AUTHORIZED. */
export function checkAuthorization(
  run: AgentRun,
  amountCents: Cents,
  basis: AuthorizationBasis,
  now: Date,
  policy: RunPolicy = DEFAULT_RUN_POLICY
): string[] {
  const reasons: string[] = [];
  const { payment, checkout } = run;
  const request = payment.confirmationRequest;
  const confirmation = payment.confirmation;

  if (run.state !== "USER_CONFIRMATION") reasons.push(`cannot authorize from ${run.state}`);
  if (run.executionMode === "real" && payment.requirement?.quoteSimulated !== false) {
    reasons.push("real execution requires a licensed (non-simulated) off-ramp");
  }
  if (basis.kind === "mandate") reasons.push("autonomous spending mandates are not enabled; explicit user confirmation is required");
  if (!checkout?.pix) reasons.push("no payment target");
  if (!request) reasons.push("no confirmation was requested");
  if (!confirmation) reasons.push("the user has not confirmed");
  if (!checkout || !request || !confirmation || !checkout.pix) return reasons;

  if (confirmation.digest !== request.digest) reasons.push("the confirmation does not match the terms shown to the user");
  if (Date.parse(request.expiresAt) <= now.getTime()) reasons.push("the confirmation request has expired");
  const total = checkout.quote.quote.totalCents;
  const amounts = [amountCents, confirmation.amountCents, request.amountCents, checkout.pix.amountCents, total];
  if (new Set(amounts).size !== 1) {
    reasons.push(`amounts differ (authorized ${formatBRL(amountCents)}, confirmed ${formatBRL(confirmation.amountCents)}, checkout ${formatBRL(total)})`);
  }
  const max = run.intent.budget.maxCents;
  if (max !== undefined && amountCents > max) reasons.push(`amount is above the budget of ${formatBRL(max)}`);
  if (!quoteIsFresh(checkout.quote, now, policy)) reasons.push("the checkout quote is stale; it must be read again");
  if (checkout.pix.expiresAt && Date.parse(checkout.pix.expiresAt) <= now.getTime()) reasons.push("the Pix has expired");
  if (!payment.walletAddress || payment.walletAddress !== request.walletAddress || payment.funds?.address !== request.walletAddress) {
    reasons.push("the wallet changed since the user confirmed");
  }
  if (payment.assessment?.kind !== "ready") reasons.push("shielded funds are not sufficient");
  if (payment.requirement && payment.requirement.grossUsdc !== request.grossUsdc) reasons.push("funding requirement changed since confirmation");
  return reasons;
}
