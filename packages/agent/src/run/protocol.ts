import type { Cents, CartQuote, ProductRequirement, SourcePlatform } from "@nape3/domain";
import type { PixEvidence } from "./types";

/**
 * Agent ⇄ browser executor protocol. The extension is an executor: it
 * observes, navigates and reads in the user's own session. It never decides,
 * never places an order and never pays. Results carry commercial data only:
 * no cookies, tokens, addresses or account identifiers.
 */

export interface CandidateToRevalidate {
  candidateId: string;
  source: SourcePlatform;
  merchantName: string;
  requirement: ProductRequirement;
  quantity: number;
  observedTotalCents: Cents;
}

export type AgentBrowserCommand =
  | { type: "REVALIDATE_CANDIDATE"; commandId: string; runId: string; candidate: CandidateToRevalidate }
  | { type: "PREPARE_CHECKOUT"; commandId: string; runId: string }
  | { type: "READ_CHECKOUT"; commandId: string; runId: string }
  | { type: "READ_PIX"; commandId: string; runId: string; expectedAmountCents: Cents }
  | { type: "VERIFY_ORDER"; commandId: string; runId: string };

export type BrowserResult =
  | { commandId: string; type: "STARTED" }
  | { commandId: string; type: "QUOTE"; quote: CartQuote; capturedAt: string; pageRef: string }
  | { commandId: string; type: "PIX"; amountCents: Cents; evidence: PixEvidence; expiresAt?: string; payloadDigest?: string }
  | { commandId: string; type: "ORDER"; confirmed: boolean; evidence: string }
  | { commandId: string; type: "UNAVAILABLE"; reason: string }
  | { commandId: string; type: "NEEDS_USER"; reason: string }
  | { commandId: string; type: "ERROR"; reason: string };

export const BROWSER_COMMAND_TYPES = ["REVALIDATE_CANDIDATE", "PREPARE_CHECKOUT", "READ_CHECKOUT", "READ_PIX", "VERIFY_ORDER"] as const;

/** Which result types answer which command. */
export function resultFits(command: AgentBrowserCommand, result: BrowserResult): boolean {
  if (command.commandId !== result.commandId) return false;
  switch (result.type) {
    case "QUOTE":
      return command.type === "REVALIDATE_CANDIDATE" || command.type === "PREPARE_CHECKOUT" || command.type === "READ_CHECKOUT";
    case "PIX":
      return command.type === "READ_PIX";
    case "ORDER":
      return command.type === "VERIFY_ORDER";
    default:
      return true;
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A result before it is tied to a command id. */
export type BrowserResultBody = DistributiveOmit<BrowserResult, "commandId">;
