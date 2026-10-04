import { describeRequirement, formatBRL } from "@nape3/domain";
import type { RunEvent } from "./events";
import { applyRunEvent } from "./reduce";
import type { AgentRun } from "./types";

/** "6,00 USDC" from base units (display only). */
export function usdcLabel(units: bigint | string): string {
  const value = typeof units === "string" ? BigInt(units) : units;
  const whole = value / 1_000_000n;
  const cents = ((value % 1_000_000n) + 9_999n) / 10_000n; // round up to 0,01
  return cents === 100n ? `${whole + 1n},00 USDC` : `${whole},${cents.toString().padStart(2, "0")} USDC`;
}

/**
 * One human line per event, for the run timeline. Observational language:
 * observed prices are "observed", revalidated ones "confirmed in your session".
 * `run` is the run *after* the event was applied.
 */
export function describeEvent(event: RunEvent, run?: AgentRun): string {
  switch (event.type) {
    case "INTENT_CREATED": {
      const { intent, requirement } = event.payload;
      const max = intent.budget.maxCents !== undefined ? `, up to ${formatBRL(intent.budget.maxCents)}` : "";
      return `Intent: ${intent.product.quantity}× ${describeRequirement(requirement)}${max}`;
    }
    case "MARKET_SEARCH_STARTED":
      return "Searching market…";
    case "MARKET_SEARCHED": {
      const n = event.payload.candidates.length;
      return n === 0
        ? `No valid candidates (${event.payload.observationCount} observations, ${event.payload.rejectedCount} rejected)`
        : `Found ${n} candidate${n === 1 ? "" : "s"} (${event.payload.sourceMode === "demo" ? "synthetic demo market" : "live market"})`;
    }
    case "CANDIDATE_SELECTED": {
      const c = run?.candidates.find((x) => x.candidateId === event.payload.candidateId);
      return c ? `Selected ${c.merchantName} on ${c.source}: observed ${formatBRL(c.observedTotalCents)}` : "Candidate selected";
    }
    case "REVALIDATION_REQUESTED":
      return "Revalidating cheapest option…";
    case "REVALIDATION_STARTED":
      return "Browser is checking the price…";
    case "BROWSER_NEEDS_USER":
      return `Action needed in the browser: ${event.payload.reason}`;
    case "QUOTE_VALIDATED":
      return event.payload.quote.pageRef.startsWith("simulated:")
        ? `Price re-read by the simulated demo executor: ${formatBRL(event.payload.quote.quote.totalCents)}`
        : `Price confirmed in your session: ${formatBRL(event.payload.quote.quote.totalCents)}`;
    case "CANDIDATE_REJECTED":
      return `Option rejected: ${event.payload.reasons.join("; ")}${run?.state === "CANDIDATES_NORMALIZED" ? ". Trying the next one" : ""}`;
    case "CHECKOUT_REQUESTED":
      return "Preparing checkout…";
    case "CHECKOUT_READY":
      return event.payload.quote.pageRef.startsWith("simulated:")
        ? `Simulated checkout at ${formatBRL(event.payload.quote.quote.totalCents)} (demo)`
        : `Checkout confirmed at ${formatBRL(event.payload.quote.quote.totalCents)}`;
    case "CHECKOUT_INVALIDATED":
      return `Checkout must be read again: ${event.payload.reason}`;
    case "PIX_REQUESTED":
      return "Looking for the Pix payment…";
    case "PIX_DETECTED":
      return `Pix detected: ${formatBRL(event.payload.pix.amountCents)}`;
    case "WALLET_REQUIRED":
      return "Waiting for wallet…";
    case "WALLET_CONNECTED":
      return `Wallet connected: ${event.payload.address.slice(0, 4)}…${event.payload.address.slice(-4)}`;
    case "WALLET_DISCONNECTED":
      return "Wallet disconnected";
    case "FUNDS_CHECKED":
      return `Funds checked: ${usdcLabel(event.payload.funds.shieldedUsdc)} shielded, ${usdcLabel(event.payload.funds.publicUsdc)} public`;
    case "SHIELD_REQUIRED": {
      const a = run?.payment.assessment;
      if (a?.kind === "shield-required" && !a.canShield) {
        return a.reason === "insufficient-public-usdc" ? `Not enough USDC: add ${usdcLabel(a.addPublicUsdc)} to the wallet` : "Not enough SOL for network fees";
      }
      return a?.kind === "shield-required" ? `Shield ${usdcLabel(a.shieldAmountUsdc)} to continue` : "Shield required";
    }
    case "PAYMENT_READY":
      return "Ready to pay";
    case "CONFIRMATION_REQUESTED":
      return `Confirm ${formatBRL(event.payload.request.amountCents)} (${usdcLabel(event.payload.request.grossUsdc)} from the shielded pool)`;
    case "USER_CONFIRMED":
      return `You confirmed ${formatBRL(event.payload.amountCents)}`;
    case "USER_REJECTED":
      return "You cancelled; nothing was charged";
    case "PAYMENT_AUTHORIZED":
      return `Payment authorized: ${formatBRL(event.payload.amountCents)}`;
    case "PAYMENT_SUBMITTED":
      return "Private funding submitted; settling…";
    case "SETTLEMENT_VERIFIED":
      return event.payload.simulated ? "Settlement verified (simulated off-ramp: no real Pix was paid)" : "Settlement verified";
    case "SETTLEMENT_FAILED":
      return `Settlement failed: ${event.payload.reason}`;
    case "ORDER_REQUESTED":
      return "Checking the order confirmation…";
    case "ORDER_CONFIRMED":
      return event.payload.evidence.startsWith("simulated:") ? "Order confirmed (simulated demo)" : "Order confirmed";
    case "RUN_FAILED":
      return `Stopped: ${event.payload.reason}`;
  }
}

/** Describes a whole log, each event with the run as it was right after it. */
export function describeLog(events: readonly RunEvent[]): Array<RunEvent & { message: string }> {
  let run: AgentRun | null = null;
  return events.map((event) => {
    const result = applyRunEvent(run, event);
    if (result.ok) run = result.run;
    return { ...event, message: describeEvent(event, run ?? undefined) };
  });
}
