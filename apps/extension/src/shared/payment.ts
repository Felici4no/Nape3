import { formatBRL, type Cents } from "@nape3/domain";
import type { PageSnapshot } from "./types";

/**
 * Crypto payment glue between the popup, the background and the UPAY3FOOD
 * Pay page (apps/web /pay). Only public data crosses these boundaries:
 * wallet address, balances, agent state. Never keys, notes or signatures.
 * Amounts travel as decimal strings (bigint is not JSON-serializable).
 */

export type PaymentDestination = "pix-payload-via-offramp" | "pix-selected-via-offramp";

export interface PendingPayment {
  paymentId: string;
  amountCents: Cents;
  merchant: string | null;
  destination: PaymentDestination;
  /** Visible Pix Copia e Cola, kept in session storage only; never in a URL. */
  pixPayload: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface WalletStatus {
  address: string;
  publicUsdc: string;
  shieldedUsdc: string | null;
  solLamports: string;
  checkedAt: string;
  agentState: string | null;
  paymentId: string | null;
}

export type Payability =
  | { payable: true; amountCents: Cents; destination: PaymentDestination; merchant: string | null; pixPayload: string | null }
  | { payable: false; reason: string };

/** "Pay R$X with crypto" is offered only for a validated checkout with Pix detected. */
export function payability(snapshot: PageSnapshot | null): Payability {
  if (!snapshot) return { payable: false, reason: "no page read" };
  const { context } = snapshot.detection;
  if (context !== "CHECKOUT" && context !== "PIX_PAYMENT") return { payable: false, reason: "not at checkout" };
  const cart = snapshot.cart;
  if (!cart || !cart.validity.valid || cart.totalCents.value === null) {
    return { payable: false, reason: "checkout total not validated" };
  }
  const total = cart.totalCents.value;
  const pix = snapshot.pix;
  const payloadVisible = pix?.preferredEvidence === "pix-copy-paste" && pix.parsedPayload?.crcValid === true;
  if (pix?.amountCents.value != null && pix.amountCents.value !== total) {
    return { payable: false, reason: `Pix amount ${formatBRL(pix.amountCents.value)} differs from checkout ${formatBRL(total)}` };
  }
  const merchant = cart.merchantName.value ?? pix?.parsedPayload?.merchantName ?? null;
  if (payloadVisible) {
    return { payable: true, amountCents: total, destination: "pix-payload-via-offramp", merchant, pixPayload: pix!.copyPastePayload.value };
  }
  if (pix?.preferredEvidence || cart.paymentMethod.value === "pix") {
    return { payable: true, amountCents: total, destination: "pix-selected-via-offramp", merchant, pixPayload: null };
  }
  return { payable: false, reason: "Pix not detected (select Pix as the payment method)" };
}

export function abbreviateAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/** 6-decimals base units → "12,50" style string (trailing zeros trimmed to 2 decimals). */
export function formatUsdcUnits(units: string): string {
  const value = BigInt(units);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0{1,4}$/, "");
  return `${whole},${fraction.padEnd(2, "0")} USDC`;
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DIGITS = /^\d{1,20}$/;
const AGENT_STATES = new Set([
  "PAYMENT_TARGET_DETECTED",
  "WALLET_REQUIRED",
  "WALLET_CONNECTED",
  "FUNDS_CHECKED",
  "SHIELD_REQUIRED",
  "PAYMENT_READY",
  "PAYMENT_AUTHORIZED",
  "SETTLED",
  "IDLE",
  "ERROR"
]);

/** Strict parser for what the Pay page reports; anything else is rejected. */
export function parseWalletReport(input: unknown): WalletStatus | null {
  if (typeof input !== "object" || input === null) return null;
  const r = input as Record<string, unknown>;
  if (typeof r.address !== "string" || !BASE58.test(r.address)) return null;
  if (typeof r.publicUsdc !== "string" || !DIGITS.test(r.publicUsdc)) return null;
  if (r.shieldedUsdc !== null && (typeof r.shieldedUsdc !== "string" || !DIGITS.test(r.shieldedUsdc))) return null;
  if (typeof r.solLamports !== "string" || !DIGITS.test(r.solLamports)) return null;
  if (typeof r.checkedAt !== "string" || Number.isNaN(Date.parse(r.checkedAt))) return null;
  const agentState = typeof r.agentState === "string" && AGENT_STATES.has(r.agentState) ? r.agentState : null;
  const paymentId = typeof r.paymentId === "string" && /^[a-z0-9-]{8,64}$/.test(r.paymentId) ? r.paymentId : null;
  return {
    address: r.address,
    publicUsdc: r.publicUsdc,
    shieldedUsdc: r.shieldedUsdc as string | null,
    solLamports: r.solLamports,
    checkedAt: new Date(Date.parse(r.checkedAt)).toISOString(),
    agentState,
    paymentId
  };
}

export interface WalletSummary {
  connected: boolean;
  label: string;
  publicUsdc: string | null;
  shieldedUsdc: string | null;
  stale: boolean;
  ageMinutes: number | null;
}

export function walletSummary(status: WalletStatus | null, now: Date, staleAfterMinutes = 30): WalletSummary {
  if (!status) {
    return { connected: false, label: "Wallet not connected", publicUsdc: null, shieldedUsdc: null, stale: false, ageMinutes: null };
  }
  const ageMinutes = Math.max(0, Math.round((now.getTime() - Date.parse(status.checkedAt)) / 60_000));
  return {
    connected: true,
    label: abbreviateAddress(status.address),
    publicUsdc: formatUsdcUnits(status.publicUsdc),
    shieldedUsdc: status.shieldedUsdc === null ? null : formatUsdcUnits(status.shieldedUsdc),
    stale: ageMinutes > staleAfterMinutes,
    ageMinutes
  };
}

/** The Pay page may only talk to us from the configured origin. */
export function isAllowedPayOrigin(origin: string | undefined, fundingAppUrl: string): boolean {
  if (!origin) return false;
  try {
    return new URL(fundingAppUrl).origin === origin;
  } catch {
    return false;
  }
}
