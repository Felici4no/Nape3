import { isSolanaSignature } from "./encoding";
import type { ChainTransaction, Commitment, SolanaRpcProvider } from "./provider";

/** Solana's maximum serialized transaction size. */
export const MAX_TRANSACTION_BYTES = 1232;

/**
 * Broadcasts a transaction the user's wallet already signed. The runtime
 * never builds or signs payment transactions itself.
 */
export async function broadcastSignedTransaction(provider: SolanaRpcProvider, rawTx: Uint8Array): Promise<string> {
  if (rawTx.length < 65) throw new RangeError("not a signed transaction (too short)");
  if (rawTx.length > MAX_TRANSACTION_BYTES) throw new RangeError(`transaction exceeds ${MAX_TRANSACTION_BYTES} bytes`);
  if (rawTx[0] === 0) throw new RangeError("transaction carries no signatures");
  return provider.sendTransaction(rawTx);
}

export interface TransferExpectation {
  mint: string;
  /** Owner (wallet) that must receive the tokens, e.g. the off-ramp deposit address. */
  destinationOwner: string;
  /** Minimum base units the destination must gain. */
  minAmount: bigint;
  commitment?: Commitment;
}

export type TransferVerification =
  | { status: "confirmed"; received: bigint; slot: number }
  | { status: "pending" }
  | { status: "failed"; reason: string };

/** Net change of `owner`'s balance of `mint` in a transaction. */
export function tokenDelta(tx: ChainTransaction, owner: string, mint: string): bigint {
  const sum = (entries: ChainTransaction["preTokenBalances"]) =>
    entries.filter((e) => e.owner === owner && e.mint === mint).reduce((total, e) => total + e.amount, 0n);
  return sum(tx.postTokenBalances) - sum(tx.preTokenBalances);
}

/**
 * Verifies on chain that a submitted payment moved at least `minAmount` of
 * `mint` to `destinationOwner` and succeeded. "pending" means not found yet
 * at the requested commitment.
 */
export async function verifyTokenTransfer(provider: SolanaRpcProvider, signature: string, expected: TransferExpectation): Promise<TransferVerification> {
  if (!isSolanaSignature(signature)) return { status: "failed", reason: "not a Solana transaction signature" };
  const tx = await provider.getTransaction(signature, expected.commitment ?? "confirmed");
  if (!tx) return { status: "pending" };
  if (tx.failed) return { status: "failed", reason: `transaction failed on chain${tx.error ? `: ${tx.error}` : ""}` };
  const received = tokenDelta(tx, expected.destinationOwner, expected.mint);
  if (received < expected.minAmount) {
    return { status: "failed", reason: `destination received ${received} base units, expected at least ${expected.minAmount}` };
  }
  return { status: "confirmed", received, slot: tx.slot };
}
