import { describeRequirement } from "@nape3/domain";
import { normalizeMerchant, type AgentBrowserCommand, type BrowserResultBody } from "@nape3/agent";
import { snapshotToObservation } from "./observation";
import type { ExtensionSettings, PageSnapshot } from "./types";

/**
 * Browser executor: answers agent-api commands from what the user's own
 * iFood tab shows. It observes, navigates (opens a search tab) and reads; it
 * never clicks, places an order or pays, and never touches iFood's DOM.
 * Results carry commercial data only (items, fees, totals, Pix amount and a
 * payload digest); never cookies, tokens, addresses or account identifiers.
 */

export interface ExecutorDecision {
  result: BrowserResultBody;
  /** Optional navigation for the user (opened once per command). */
  open?: string;
}

const SEARCH_URL = "https://www.ifood.com.br/busca?q=";

function readQuote(snapshot: PageSnapshot, settings: ExtensionSettings, observerId: string) {
  const built = snapshotToObservation(snapshot, settings, observerId);
  return built.ok ? built.observation.quote : { error: built.reason };
}

/** SHA-256 hex of a Pix copy-paste payload (the payload itself never leaves the browser). */
export async function digestPayload(payload: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function answerCommand(
  command: AgentBrowserCommand,
  snapshot: PageSnapshot | null,
  settings: ExtensionSettings,
  observerId: string
): Promise<ExecutorDecision> {
  const context = snapshot?.detection.context ?? "UNKNOWN";

  switch (command.type) {
    case "REVALIDATE_CANDIDATE": {
      const c = command.candidate;
      if (c.source !== "ifood") return { result: { type: "UNAVAILABLE", reason: `this executor reads iFood only; candidate is on ${c.source}` } };
      const want = `${c.quantity}× ${describeRequirement(c.requirement)} at ${c.merchantName}`;
      if (!snapshot?.cart || (context !== "CART" && context !== "CHECKOUT")) {
        return { result: { type: "NEEDS_USER", reason: `open ${c.merchantName} on iFood and add ${want.split(" at ")[0]} to the bag` }, open: SEARCH_URL + encodeURIComponent(c.merchantName) };
      }
      const quote = readQuote(snapshot, settings, observerId);
      if ("error" in quote) return { result: { type: "NEEDS_USER", reason: `the bag could not be read reliably (${quote.error}); open it again` } };
      if (normalizeMerchant(quote.merchant.name) !== normalizeMerchant(c.merchantName)) {
        return { result: { type: "NEEDS_USER", reason: `the bag is from ${quote.merchant.name}; the agent needs ${want}` }, open: SEARCH_URL + encodeURIComponent(c.merchantName) };
      }
      return { result: { type: "QUOTE", quote, capturedAt: snapshot.capturedAt, pageRef: snapshot.pageRef } };
    }

    case "PREPARE_CHECKOUT":
    case "READ_CHECKOUT": {
      if (!snapshot?.cart || context !== "CHECKOUT") return { result: { type: "NEEDS_USER", reason: "go to the iFood checkout (Finalizar pedido) and choose Pix" } };
      const quote = readQuote(snapshot, settings, observerId);
      if ("error" in quote) return { result: { type: "NEEDS_USER", reason: `the checkout could not be read reliably (${quote.error})` } };
      return { result: { type: "QUOTE", quote: { ...quote, stage: "checkout" }, capturedAt: snapshot.capturedAt, pageRef: snapshot.pageRef } };
    }

    case "READ_PIX": {
      const pix = snapshot?.pix;
      const payload = pix?.copyPastePayload.value;
      const amount = pix?.parsedPayload?.amountCents ?? pix?.amountCents.value ?? null;
      if (payload && amount !== null) {
        return {
          result: {
            type: "PIX",
            amountCents: amount,
            evidence: "pix-copy-paste",
            payloadDigest: await digestPayload(payload),
            ...(pix?.expiresAt.value ? { expiresAt: pix.expiresAt.value } : {})
          }
        };
      }
      if (pix?.qrCodePresent && amount !== null) return { result: { type: "PIX", amountCents: amount, evidence: "qr-code" } };
      // Pix chosen at checkout: iFood creates the code after the order; the amount is the checkout total.
      if (pix?.pixOptionVisible && context === "CHECKOUT" && snapshot?.cart?.totalCents.value != null && snapshot.cart.validity.valid) {
        return { result: { type: "PIX", amountCents: snapshot.cart.totalCents.value, evidence: "pix-selected" } };
      }
      return { result: { type: "NEEDS_USER", reason: "choose Pix as the payment method on the iFood checkout" } };
    }

    case "VERIFY_ORDER":
      return context === "ORDER_CONFIRMATION"
        ? { result: { type: "ORDER", confirmed: true, evidence: snapshot!.pageRef } }
        : { result: { type: "NEEDS_USER", reason: "open the iFood order page so the agent can confirm the order" } };
  }
}
