import type { AgentContext } from "@nape3/agent";
import { cents, type Cents } from "@nape3/domain";
import type { PaymentRequest } from "./flow";

/**
 * Messaging with the UPAY3FOOD.agent extension (externally_connectable).
 * The popup opens this page with #pay=<paymentId>&ext=<extensionId>; the
 * checkout (incl. Pix payload) is fetched from the extension, never put in
 * the URL. Only public data goes back: address, balances, agent state.
 */

// Read lazily: this module may be imported during server rendering.
const hashParams = () => new URLSearchParams(typeof location === "undefined" ? "" : location.hash.slice(1));
const extensionIdOf = () => hashParams().get("ext");

interface ChromeRuntime {
  sendMessage(extensionId: string, message: unknown, callback: (response: unknown) => void): void;
  lastError?: { message?: string };
}

function runtime(): ChromeRuntime | null {
  const rt = (globalThis as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
  return rt && typeof rt.sendMessage === "function" && extensionIdOf() ? rt : null;
}

function send(message: unknown): Promise<Record<string, unknown> | null> {
  const rt = runtime();
  const extensionId = extensionIdOf();
  if (!rt || !extensionId) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      rt.sendMessage(extensionId, message, (response) => {
        void rt.lastError; // read to silence "Unchecked runtime.lastError"
        resolve((response as Record<string, unknown> | undefined) ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

export const connectedToExtension = () => runtime() !== null;

/**
 * The checkout to pay: from the extension (#pay=<id>&ext=<id>), or from the
 * website itself (#amountCents=…&merchant=…, e.g. "Execute" on a market page).
 */
export async function loadPaymentRequest(): Promise<PaymentRequest | null> {
  const params = hashParams();
  const paymentId = params.get("pay");
  if (paymentId) {
    const response = await send({ type: "GET_PAYMENT_CONTEXT", paymentId });
    const payment = response?.ok ? (response.payment as Record<string, unknown>) : null;
    if (payment && typeof payment.amountCents === "number") {
      return {
        paymentId,
        amountCents: cents(payment.amountCents),
        merchant: typeof payment.merchant === "string" ? payment.merchant : null,
        destination: payment.destination === "pix-payload-via-offramp" ? "pix-payload-via-offramp" : "pix-selected-via-offramp"
      };
    }
    return null;
  }
  const amount = Number(params.get("amountCents"));
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  return { paymentId: null, amountCents: cents(amount) as Cents, merchant: params.get("merchant"), destination: "pix-selected-via-offramp" };
}

export function reportToExtension(context: AgentContext, shieldedUsdc: bigint | null, request: PaymentRequest): void {
  if (context.state === "WALLET_REQUIRED" && !context.walletAddress) return;
  const funds = context.funds;
  if (!funds) return; // only report once balances are known
  void send({
    type: "REPORT_WALLET_STATUS",
    status: {
      address: funds.address,
      publicUsdc: funds.publicUsdc.toString(),
      shieldedUsdc: shieldedUsdc === null ? null : shieldedUsdc.toString(),
      solLamports: funds.solLamports.toString(),
      checkedAt: funds.checkedAt,
      agentState: context.state,
      paymentId: request.paymentId
    }
  });
}

export function reportDisconnected(): void {
  void send({ type: "WALLET_DISCONNECTED" });
}
