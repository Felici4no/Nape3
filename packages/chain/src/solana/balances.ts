import { isSolanaAddress } from "./encoding";
import type { SolanaRpcProvider } from "./provider";

/** Circle USDC SPL mints. */
export const USDC_MINTS = {
  "mainnet-beta": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
} as const;

export interface PublicWalletBalances {
  address: string;
  /** USDC base units across the owner's token accounts. */
  publicUsdc: bigint;
  solLamports: bigint;
  readAt: string;
  provider: string;
}

/** Public (non-shielded) balances, read from chain. No signature, no key. */
export async function readWalletBalances(provider: SolanaRpcProvider, address: string, mint: string, now: Date = new Date()): Promise<PublicWalletBalances> {
  if (!isSolanaAddress(address)) throw new RangeError("not a Solana address");
  const [publicUsdc, solLamports] = await Promise.all([provider.getTokenBalance(address, mint), provider.getSolBalance(address)]);
  return { address, publicUsdc, solLamports, readAt: now.toISOString(), provider: provider.name };
}
