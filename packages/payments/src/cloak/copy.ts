/**
 * User-facing privacy copy. One place, so the UI, CLI and docs say the same
 * thing — and never claim more than Cloak provides.
 */
export const PRIVACY_COPY = {
  headline: "Your purchase funding is shielded before settlement.",
  whatIsHidden:
    "On Solana, the payment to the off-ramp comes out of the Cloak shielded pool, not from your wallet. " +
    "Observers cannot link your wallet's history to this purchase.",
  whatIsNotHidden:
    "Pix is not private on-chain or off-chain: the off-ramp and the merchant still see the Pix payment. " +
    "Your deposit into the pool and the amount leaving it are visible on Solana; only the link between them is hidden.",
  tip: "Shield in advance and in round amounts: shielding the exact purchase amount right before paying makes the link easy to guess."
} as const;
