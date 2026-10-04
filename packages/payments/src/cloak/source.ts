import { address } from "@cloak.dev/sdk";
import type { FundingSource } from "../router";
import { formatUsdc, type SolanaCluster } from "../solana";
import { PRIVACY_COPY } from "./copy";
import type { CloakFunding } from "./funding";
import { grossUpWithdrawal } from "./units";

/**
 * Router funding source backed by the Cloak shielded USDC pool: the off-ramp
 * is paid by a Cloak withdrawal, so its deposit is not linked on-chain to the
 * user's public wallet. `simulated` must be true only for the mock SDK.
 */
export function cloakFundingSource(funding: CloakFunding, options: { simulated: boolean }): FundingSource {
  return {
    kind: "cloak-shielded",
    simulated: options.simulated,
    privacyNote: `${PRIVACY_COPY.headline} ${PRIVACY_COPY.whatIsNotHidden}`,
    available: async () => (await funding.shieldedBalance()).total,
    costFor: (amount) => grossUpWithdrawal(amount) - amount,
    describe: (amount, depositAddress, cluster: SolanaCluster) => [
      `Unshield ${formatUsdc(grossUpWithdrawal(amount))} from the Cloak USDC pool on ${cluster} ` +
        `(Cloak fee ${formatUsdc(grossUpWithdrawal(amount) - amount)}); ${formatUsdc(amount)} reaches ${depositAddress}`,
      "The off-ramp deposit comes from the shielded pool, not from your wallet"
    ],
    fund: async (to, amount) => funding.fundPayment(address(to), amount)
  };
}
