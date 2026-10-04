import { MIN_DEPOSIT_SPL_BASE_UNITS, WITHDRAW_FEE_BPS, WITHDRAW_FIXED_FEE } from "@cloak.dev/sdk";

/**
 * USDC amount math for the Cloak USDC pool. Everything is bigint base units
 * (1 USDC = 1_000_000n). Constants come from @cloak.dev/sdk; the deployed
 * PoolConfig remains the on-chain source of truth.
 */

export type UsdcUnits = bigint;

export const USDC_MIN_DEPOSIT: UsdcUnits = MIN_DEPOSIT_SPL_BASE_UNITS;

/** Protocol fee charged on the amount leaving the pool: fixed + 30 bps. */
export function cloakWithdrawFee(amount: UsdcUnits): UsdcUnits {
  if (amount < 0n) throw new RangeError("amount must be non-negative");
  return WITHDRAW_FIXED_FEE + (amount * WITHDRAW_FEE_BPS) / 10_000n;
}

/** What the recipient receives when `gross` leaves the pool (0 if the fee eats it). */
export function netAfterWithdrawFee(gross: UsdcUnits): UsdcUnits {
  const net = gross - cloakWithdrawFee(gross);
  return net > 0n ? net : 0n;
}

/**
 * Smallest gross withdrawal such that the recipient receives at least `net`.
 * Closed-form estimate, then corrected by integer steps (floor division).
 */
export function grossUpWithdrawal(net: UsdcUnits): UsdcUnits {
  if (net <= 0n) throw new RangeError("net amount must be positive");
  let gross = ((net + WITHDRAW_FIXED_FEE) * 10_000n) / (10_000n - WITHDRAW_FEE_BPS);
  while (netAfterWithdrawFee(gross) < net) gross += 1n;
  while (gross > 1n && netAfterWithdrawFee(gross - 1n) >= net) gross -= 1n;
  return gross;
}

export function assertShieldable(amount: UsdcUnits): void {
  if (amount < USDC_MIN_DEPOSIT) {
    throw new RangeError(`Cloak USDC deposits must be at least ${USDC_MIN_DEPOSIT} base units (1.00 USDC)`);
  }
}

/** "1.234567" / "1,5" / "2" USDC → base units, string arithmetic only. */
export function parseUsdc(text: string): UsdcUnits {
  const match = /^\s*(\d+)(?:[.,](\d{1,6}))?\s*$/.exec(text);
  if (!match) throw new Error(`invalid USDC amount: ${text}`);
  return BigInt(match[1]!) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}
