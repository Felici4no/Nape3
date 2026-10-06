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
const EXT_KEY = "upay3food.extensionId";

/**
 * Extension id: from the popup's link (#ext=…, remembered in this browser),
 * then from earlier visits, then from NEXT_PUBLIC_EXTENSION_ID.
 */
function extensionIdOf(): string | null {
  const fromHash = hashParams().get("ext");
  try {
    if (fromHash && /^[a-p]{32}$/.test(fromHash)) {
      localStorage.setItem(EXT_KEY, fromHash);
      return fromHash;
    }
    const remembered = typeof localStorage === "undefined" ? null : localStorage.getItem(EXT_KEY);
    if (remembered) return remembered;
  } catch {
    /* storage blocked: fall through */
  }
  const fromEnv = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_EXTENSION_ID : undefined;
  return fromHash ?? fromEnv ?? null;
}

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

/** The extension's browser-executor id, so a run is bound to this browser. null if not installed/configured. */
export async function requestExecutor(): Promise<{ executorId: string; agentApiUrl: string } | { error: string }> {
  const response = await send({ type: "GET_EXECUTOR" });
  if (!response) return { error: "extension not reachable from this page" };
  if (!response.ok || typeof response.executorId !== "string") return { error: String(response.error ?? "extension executor unavailable") };
  return { executorId: response.executorId, agentApiUrl: String(response.agentApiUrl) };
}

/** Tells the extension a run bound to it started, so it polls right away. */
export async function notifyRunStarted(): Promise<void> {
  await send({ type: "AGENT_RUN_STARTED" });
}

// ---------------------------------------------------------------------------
// Connectivity test (/diagnostics)
// ---------------------------------------------------------------------------

export function currentExtensionId(): string | null {
  return extensionIdOf();
}

/** Remembers the extension id typed on /diagnostics (unpacked extensions have a per-machine id). */
export function setExtensionId(id: string): boolean {
  if (!/^[a-p]{32}$/.test(id)) return false;
  try {
    localStorage.setItem(EXT_KEY, id);
    return true;
  } catch {
    return false;
  }
}

export interface ExtensionPing {
  /** web → background answered. */
  reachable: boolean;
  /** Why not, in terms of the transport link that failed. */
  failure:
    | null
    | "NO_EXTENSION_ID"
    | "CHROME_RUNTIME_UNAVAILABLE" // not Chrome, or no installed extension lists this site in externally_connectable
    | "EXTENSION_NOT_FOUND" // id wrong, extension disabled/not installed, or this origin not allowed by its manifest
    | "ORIGIN_REJECTED" // the extension answered but refused this origin
    | "TIMEOUT";
  detail: string | null;
  report: Record<string, unknown> | null;
  latencyMs: number;
}

/**
 * Asks the extension for its connectivity report: web → background →
 * content script in the iFood tab, plus its agent-api/executor state.
 * Read-only; no commercial action.
 */
export async function pingExtension(timeoutMs = 3_000): Promise<ExtensionPing> {
  const started = Date.now();
  const done = (p: Omit<ExtensionPing, "latencyMs">): ExtensionPing => ({ ...p, latencyMs: Date.now() - started });
  const extensionId = extensionIdOf();
  if (!extensionId) return done({ reachable: false, failure: "NO_EXTENSION_ID", detail: "paste the id from chrome://extensions", report: null });
  const rt = (globalThis as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
  if (!rt || typeof rt.sendMessage !== "function") {
    return done({
      reachable: false,
      failure: "CHROME_RUNTIME_UNAVAILABLE",
      detail: "chrome.runtime is not exposed to this page: not Chrome, or no installed extension lists this site in externally_connectable",
      report: null
    });
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(done({ reachable: false, failure: "TIMEOUT", detail: `no answer in ${timeoutMs} ms`, report: null })), timeoutMs);
    try {
      rt.sendMessage(extensionId, { type: "PING" }, (response) => {
        clearTimeout(timer);
        const lastError = rt.lastError?.message ?? null;
        const r = (response as { ok?: boolean; error?: string; report?: Record<string, unknown> } | undefined) ?? null;
        if (!r) return resolve(done({ reachable: false, failure: "EXTENSION_NOT_FOUND", detail: lastError ?? "no response", report: null }));
        if (!r.ok) return resolve(done({ reachable: false, failure: r.error === "origin not allowed" ? "ORIGIN_REJECTED" : "EXTENSION_NOT_FOUND", detail: r.error ?? null, report: null }));
        resolve(done({ reachable: true, failure: null, detail: null, report: r.report ?? null }));
      });
    } catch (error) {
      clearTimeout(timer);
      resolve(done({ reachable: false, failure: "EXTENSION_NOT_FOUND", detail: error instanceof Error ? error.message : String(error), report: null }));
    }
  });
}
