import { formatBRL, type Cents, type PurchaseIntent } from "@nape3/domain";
import type { Decision } from "./decision";

/**
 * Explicit agent state machine. Transitions are a pure function; every move is
 * recorded in `history`. PAYMENT_AUTHORIZED is reachable only with an explicit
 * user authorization whose amount matches the detected payment target.
 */

export type AgentState =
  | "IDLE"
  | "INTENT_CAPTURED"
  | "MARKET_SEARCH"
  | "CANDIDATES_NORMALIZED"
  | "CONSTRAINTS_APPLIED"
  | "BEST_OPTION_SELECTED"
  | "USER_CONFIRMATION"
  | "CHECKOUT_PREPARED"
  | "PAYMENT_TARGET_DETECTED"
  | "PAYMENT_AUTHORIZED"
  | "SETTLED"
  | "NO_VALID_OPTION"
  | "ERROR";

export interface PaymentTarget {
  method: "pix";
  amountCents: Cents;
  /** Where the target came from: visible copy-paste payload, QR, or visible key. */
  evidence: "pix-copy-paste" | "qr-code" | "pix-key";
  expiresAt?: string;
}

export interface UserAuthorization {
  /** Must be literally true — set only by an explicit user action in the UI. */
  confirmedByUser: true;
  amountCents: Cents;
  at: string;
}

export type AgentEvent =
  | { type: "INTENT_CAPTURED"; intent: PurchaseIntent }
  | { type: "MARKET_SEARCH_STARTED" }
  | { type: "CANDIDATES_NORMALIZED"; count: number }
  | { type: "CONSTRAINTS_APPLIED"; validCount: number }
  | { type: "OPTION_SELECTED"; decision: Decision }
  | { type: "CONFIRMATION_REQUESTED" }
  | { type: "USER_CONFIRMED"; at: string }
  | { type: "USER_REJECTED" }
  | { type: "CHECKOUT_PREPARED"; checkoutTotalCents: Cents }
  | { type: "PAYMENT_TARGET_DETECTED"; target: PaymentTarget }
  | { type: "AUTHORIZE_PAYMENT"; authorization: UserAuthorization }
  | { type: "SETTLED"; reference: string }
  | { type: "FAIL"; error: string }
  | { type: "RESET" };

export interface AgentContext {
  state: AgentState;
  intent?: PurchaseIntent;
  decision?: Decision;
  userConfirmedAt?: string;
  checkoutTotalCents?: Cents;
  paymentTarget?: PaymentTarget;
  authorization?: UserAuthorization;
  settlementReference?: string;
  error?: string;
  warnings: string[];
  history: Array<{ from: AgentState; to: AgentState; event: AgentEvent["type"]; at: string }>;
}

export type TransitionResult = { ok: true; context: AgentContext } | { ok: false; error: string; context: AgentContext };

export function initialContext(): AgentContext {
  return { state: "IDLE", warnings: [], history: [] };
}

const TERMINAL: readonly AgentState[] = ["SETTLED"];

export function transition(context: AgentContext, event: AgentEvent, now: Date = new Date()): TransitionResult {
  const at = now.toISOString();
  const reject = (error: string): TransitionResult => ({ ok: false, error, context });
  const move = (to: AgentState, patch: Partial<AgentContext> = {}): TransitionResult => ({
    ok: true,
    context: {
      ...context,
      ...patch,
      state: to,
      warnings: patch.warnings ?? context.warnings,
      history: [...context.history, { from: context.state, to, event: event.type, at }]
    }
  });

  if (event.type === "RESET") return move("IDLE", { ...initialContext(), history: context.history });
  if (event.type === "FAIL") {
    if (TERMINAL.includes(context.state)) return reject(`cannot fail from terminal state ${context.state}`);
    return move("ERROR", { error: event.error });
  }

  switch (context.state) {
    case "IDLE":
      if (event.type === "INTENT_CAPTURED") return move("INTENT_CAPTURED", { intent: event.intent });
      break;
    case "INTENT_CAPTURED":
      if (event.type === "MARKET_SEARCH_STARTED") return move("MARKET_SEARCH");
      break;
    case "MARKET_SEARCH":
      if (event.type === "CANDIDATES_NORMALIZED") {
        return event.count > 0 ? move("CANDIDATES_NORMALIZED") : move("NO_VALID_OPTION");
      }
      break;
    case "CANDIDATES_NORMALIZED":
      if (event.type === "CONSTRAINTS_APPLIED") {
        return event.validCount > 0 ? move("CONSTRAINTS_APPLIED") : move("NO_VALID_OPTION");
      }
      break;
    case "CONSTRAINTS_APPLIED":
      if (event.type === "OPTION_SELECTED") {
        if (event.decision.status !== "selected") return move("NO_VALID_OPTION", { decision: event.decision });
        return move("BEST_OPTION_SELECTED", { decision: event.decision });
      }
      break;
    case "BEST_OPTION_SELECTED":
      if (event.type === "CONFIRMATION_REQUESTED") return move("USER_CONFIRMATION");
      break;
    case "USER_CONFIRMATION":
      if (event.type === "USER_CONFIRMED") return { ok: true, context: { ...context, userConfirmedAt: event.at } };
      if (event.type === "USER_REJECTED") return move("IDLE", { ...initialContext(), history: context.history });
      if (event.type === "CHECKOUT_PREPARED") {
        if (!context.userConfirmedAt) return reject("checkout requires explicit user confirmation first");
        const warnings = [...context.warnings];
        const expected = context.decision?.bestExecutable?.totalCents;
        if (expected != null && expected !== event.checkoutTotalCents) {
          warnings.push(
            `checkout total ${formatBRL(event.checkoutTotalCents)} differs from the evaluated ${formatBRL(expected)}`
          );
        }
        return move("CHECKOUT_PREPARED", { checkoutTotalCents: event.checkoutTotalCents, warnings });
      }
      break;
    case "CHECKOUT_PREPARED":
      if (event.type === "PAYMENT_TARGET_DETECTED") {
        const warnings = [...context.warnings];
        if (context.checkoutTotalCents !== undefined && context.checkoutTotalCents !== event.target.amountCents) {
          warnings.push(
            `payment target ${formatBRL(event.target.amountCents)} differs from checkout total ${formatBRL(context.checkoutTotalCents)}`
          );
        }
        return move("PAYMENT_TARGET_DETECTED", { paymentTarget: event.target, warnings });
      }
      break;
    case "PAYMENT_TARGET_DETECTED":
      if (event.type === "AUTHORIZE_PAYMENT") {
        const { authorization } = event;
        const target = context.paymentTarget!;
        if (authorization.confirmedByUser !== true) return reject("payment requires explicit user authorization");
        if (authorization.amountCents !== target.amountCents) {
          return reject(
            `authorized ${formatBRL(authorization.amountCents)} does not match payment target ${formatBRL(target.amountCents)}`
          );
        }
        if (target.expiresAt && Date.parse(target.expiresAt) <= now.getTime()) {
          return reject("payment target has expired");
        }
        return move("PAYMENT_AUTHORIZED", { authorization });
      }
      break;
    case "PAYMENT_AUTHORIZED":
      if (event.type === "SETTLED") return move("SETTLED", { settlementReference: event.reference });
      break;
    case "NO_VALID_OPTION":
    case "ERROR":
    case "SETTLED":
      break;
  }
  return reject(`invalid transition: ${event.type} from ${context.state}`);
}

/** Applies events in order; stops at the first invalid one. */
export function run(events: AgentEvent[], start: AgentContext = initialContext(), now?: Date): TransitionResult {
  let current: TransitionResult = { ok: true, context: start };
  for (const event of events) {
    current = transition(current.context, event, now);
    if (!current.ok) return current;
  }
  return current;
}
