import type { Address, CloakRpc } from "@cloak.dev/sdk";

/**
 * Public balances of the connected wallet, read-only (no signature):
 * USDC across the owner's token accounts for `mint`, and SOL for fees.
 * Amounts are bigint base units / lamports.
 */
export interface PublicBalances {
  publicUsdc: bigint;
  solLamports: bigint;
}

/** The two RPC methods used; CloakRpc (a @solana/kit Rpc) provides both. */
export type BalanceRpc = Pick<CloakRpc, "getBalance" | "getTokenAccountsByOwner">;

interface ParsedTokenAccount {
  account: { data: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } };
}

export async function readPublicBalances(rpc: BalanceRpc, owner: Address, mint: Address): Promise<PublicBalances> {
  const [sol, tokens] = await Promise.all([
    rpc.getBalance(owner, { commitment: "confirmed" }).send(),
    rpc.getTokenAccountsByOwner(owner, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }).send()
  ]);
  let publicUsdc = 0n;
  for (const entry of tokens.value as unknown as ParsedTokenAccount[]) {
    const amount = entry.account.data.parsed?.info?.tokenAmount?.amount;
    if (typeof amount === "string" && /^\d+$/.test(amount)) publicUsdc += BigInt(amount);
  }
  return { publicUsdc, solLamports: BigInt(sol.value) };
}
