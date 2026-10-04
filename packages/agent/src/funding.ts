import type { Cents } from "@nape3/domain";

/**
 * Funding assessment for paying a checkout with crypto (pure bigint math).
 * Amounts are USDC base units (1 USDC = 1_000_000n) and SOL lamports.
 * Fee formulas live in @nape3/payments/cloak; this module only compares.
 */

export interface WalletFunds {
  address: string;
  /** USDC in the user's public wallet (base units). */
  publicUsdc: bigint;
  /** USDC in the user's Cloak shielded pool (base units). */
  shieldedUsdc: bigint;
  /** SOL for network fees (lamports). */
  solLamports: bigint;
  checkedAt: string;
}

export type PaymentDestinationType =
  /** Pix Copia e Cola / QR visible: the exact charge is known. */
  | "pix-payload-via-offramp"
  /** Pix chosen at checkout; the code is generated after the order is placed. */
  | "pix-selected-via-offramp";

export interface FundingRequirement {
  /** Exact BRL checkout total being paid. */
  checkoutTotalCents: Cents;
  /** USDC the off-ramp must receive to settle the Pix (quote). */
  offrampNetUsdc: bigint;
  /** Cloak withdraw fee on top of it. */
  cloakFeeUsdc: bigint;
  /** offrampNetUsdc + cloakFeeUsdc: what leaves the shielded pool. */
  grossUsdc: bigint;
  destination: PaymentDestinationType;
  /** True while the off-ramp quote is simulated (no licensed provider). */
  quoteSimulated: boolean;
}

export interface FundingPolicy {
  /** Cloak minimum deposit (USDC base units). */
  minShieldUsdc: bigint;
  /** SOL needed to sign a shield (fees + lookup-table rent), lamports. */
  minSolForShieldLamports: bigint;
}

export const DEFAULT_FUNDING_POLICY: FundingPolicy = {
  minShieldUsdc: 1_000_000n,
  minSolForShieldLamports: 10_000_000n
};

export type FundingAssessment =
  | { kind: "ready"; spareShieldedUsdc: bigint }
  | {
      kind: "shield-required";
      /** What the shielded balance lacks. */
      missingUsdc: bigint;
      /** Suggested shield: missing, rounded UP to whole USDC, at least the Cloak minimum. */
      shieldAmountUsdc: bigint;
      canShield: true;
    }
  | {
      kind: "shield-required";
      missingUsdc: bigint;
      shieldAmountUsdc: bigint;
      canShield: false;
      reason: "insufficient-public-usdc" | "insufficient-sol";
      /** USDC to add to the public wallet first (for insufficient-public-usdc). */
      addPublicUsdc: bigint;
    };

const ONE_USDC = 1_000_000n;

export function assessFunding(
  requirement: FundingRequirement,
  funds: WalletFunds,
  policy: FundingPolicy = DEFAULT_FUNDING_POLICY
): FundingAssessment {
  if (funds.shieldedUsdc >= requirement.grossUsdc) {
    return { kind: "ready", spareShieldedUsdc: funds.shieldedUsdc - requirement.grossUsdc };
  }
  const missingUsdc = requirement.grossUsdc - funds.shieldedUsdc;
  // Whole-USDC amounts are less linkable than the exact purchase amount.
  const rounded = ((missingUsdc + ONE_USDC - 1n) / ONE_USDC) * ONE_USDC;
  const shieldAmountUsdc = rounded < policy.minShieldUsdc ? policy.minShieldUsdc : rounded;
  if (funds.publicUsdc < shieldAmountUsdc) {
    return {
      kind: "shield-required",
      missingUsdc,
      shieldAmountUsdc,
      canShield: false,
      reason: "insufficient-public-usdc",
      addPublicUsdc: shieldAmountUsdc - funds.publicUsdc
    };
  }
  if (funds.solLamports < policy.minSolForShieldLamports) {
    return { kind: "shield-required", missingUsdc, shieldAmountUsdc, canShield: false, reason: "insufficient-sol", addPublicUsdc: 0n };
  }
  return { kind: "shield-required", missingUsdc, shieldAmountUsdc, canShield: true };
}
