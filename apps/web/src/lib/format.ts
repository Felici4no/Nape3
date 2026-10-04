import { formatBRL, type Cents } from "@nape3/domain";
import type { PriceChange } from "@nape3/market";
import { brlCentsToUsdcBaseUnits, formatUsdcDisplay } from "@nape3/payments";

/** Client-safe formatting (no fixtures, no Node APIs). */

/** BRL → USDC estimate. The off-ramp is simulated, so this rate is too. */
export const USDC_RATE = { centsPerUsdc: 540, simulated: true, label: "mock rate R$5,40 / USDC" } as const;

/** BRL cents → USDC estimate, shown to the cent (it is an estimate at a simulated rate). */
export function usdcEstimate(cents: number): string {
  const units = brlCentsToUsdcBaseUnits(Math.max(0, cents), USDC_RATE.centsPerUsdc);
  const rounded = ((units + 5_000n) / 10_000n) * 10_000n; // round half up to 0,01 USDC
  return formatUsdcDisplay(rounded);
}

export function brl(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? "—" : formatBRL(cents as Cents);
}

export function freshnessLabel(minutes: number | null): string {
  if (minutes === null) return "no fresh data";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

export function changeLabel(change: PriceChange): string {
  const pct = (Math.abs(change.changeBps) / 100).toFixed(1).replace(".", ",");
  return `${change.changeCents > 0 ? "+" : change.changeCents < 0 ? "−" : ""}${pct}%`;
}

export function shortAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}
