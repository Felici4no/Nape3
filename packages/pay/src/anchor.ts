import { Buffer } from "buffer";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { connectWallet } from "./wallet";
import { shieldRpc } from "./runtime";

/**
 * Solana transparency anchor: one SPL Memo transaction, signed by the user's
 * wallet, that records a SHA-256 of the published methodology and of the
 * calculation code. Anyone can read it back and compare it with the version
 * the site serves. No funds move; the only cost is the network fee.
 */

export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const ANCHOR_PREFIX = "UPAY3FOOD transparency v1";

export interface AnchorPayload {
  methodologySha256: string;
  engineSha256: string;
  commit: string | null;
}

const HEX64 = /^[0-9a-f]{64}$/;

export function anchorMemo(p: AnchorPayload): string {
  if (!HEX64.test(p.methodologySha256) || !HEX64.test(p.engineSha256)) throw new Error("hashes must be SHA-256 hex");
  return `${ANCHOR_PREFIX} | methodology sha256:${p.methodologySha256} | engine sha256:${p.engineSha256}${p.commit ? ` | commit ${p.commit}` : ""}`;
}

/** Reads an anchor memo back (from a memo string or from a transaction's log messages). */
export function parseAnchorMemo(text: string): AnchorPayload | null {
  const m = /UPAY3FOOD transparency v1 \| methodology sha256:([0-9a-f]{64}) \| engine sha256:([0-9a-f]{64})(?: \| commit ([0-9a-f]{7,40}))?/.exec(text);
  return m ? { methodologySha256: m[1]!, engineSha256: m[2]!, commit: m[3] ?? null } : null;
}

function connection(): Connection {
  // Same-origin proxy to RPC Fast on the deployed site (no key in the browser).
  return new Connection(shieldRpc().url, "confirmed");
}

export interface AnchorResult {
  signature: string;
  signer: string;
  memo: string;
  slot: number | null;
}

/** Builds, signs (wallet prompt) and sends the memo transaction, then waits for confirmation. */
export async function anchorOnSolana(payload: AnchorPayload): Promise<AnchorResult> {
  const memo = anchorMemo(payload);
  const wallet = await connectWallet();
  const signer = new PublicKey(wallet.address);
  const conn = connection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: signer, blockhash, lastValidBlockHeight }).add(
    new TransactionInstruction({
      programId: new PublicKey(MEMO_PROGRAM_ID),
      keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
      data: Buffer.from(memo, "utf8")
    })
  );
  const signed = (await wallet.provider.signTransaction(tx)) as Transaction;
  const signature = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
  // Poll the status over HTTP (the same-origin proxy has no websocket for confirmTransaction).
  for (let i = 0; i < 40; i++) {
    const { value } = await conn.getSignatureStatuses([signature]);
    const status = value[0];
    if (status?.err) throw new Error(`transaction failed: ${JSON.stringify(status.err)}`);
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) {
      return { signature, signer: signer.toBase58(), memo, slot: status.slot };
    }
    if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) throw new Error(`not confirmed before the blockhash expired; check ${signature} on an explorer`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`still unconfirmed after 60 s; check ${signature} on an explorer before trying again`);
}

export interface AnchorCheck {
  found: boolean;
  payload: AnchorPayload | null;
  slot: number | null;
  blockTime: number | null;
  signer: string | null;
}

/** Fetches a transaction and reads its UPAY3FOOD memo, for verification by anyone. */
export async function readAnchor(signature: string): Promise<AnchorCheck> {
  const tx = await connection().getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!tx) return { found: false, payload: null, slot: null, blockTime: null, signer: null };
  const logs = (tx.meta?.logMessages ?? []).join("\n");
  const keys = tx.transaction.message.getAccountKeys?.().staticAccountKeys ?? [];
  return { found: true, payload: parseAnchorMemo(logs), slot: tx.slot, blockTime: tx.blockTime ?? null, signer: keys[0]?.toBase58() ?? null };
}
