import type { Utxo } from "@cloak.dev/sdk";

/**
 * Persistence for shielded notes (UTXOs). A note is the ONLY spendable form of
 * shielded funds, so every output a transaction returns must be persisted —
 * and read back — before the flow reports success.
 *
 * Serialized notes contain spend secrets. Stores must keep them on the user's
 * device only (file with 0600 permissions, or encrypted browser storage).
 */

export type NoteStatus = "unspent" | "pending-spend" | "spent";

export interface StoredNote {
  /** Commitment (hex) — unique per note, safe to log. */
  id: string;
  mint: string;
  /** Decimal string of the bigint amount (JSON has no bigint). */
  amount: string;
  /** base64(serializeUtxo(note)) — SECRET. */
  serialized: string;
  /**
   * Leaf index and level-0 sibling, stored explicitly: serializeUtxo keeps
   * neither the sibling nor an index of 0.
   */
  index: number;
  siblingCommitment?: string;
  status: NoteStatus;
  /** Signature of the transaction that created the note. */
  createdBy: string;
  /** Signature of the transaction that spent it, once known. */
  spentBy?: string;
  createdAt: string;
}

export interface NoteStore {
  load(): Promise<StoredNote[]>;
  save(notes: StoredNote[]): Promise<void>;
}

export class MemoryNoteStore implements NoteStore {
  private notes: StoredNote[] = [];
  async load() {
    return this.notes.map((n) => ({ ...n }));
  }
  async save(notes: StoredNote[]) {
    this.notes = notes.map((n) => ({ ...n }));
  }
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

export function bigintHex(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

export function commitmentHex(utxo: Utxo): string {
  if (utxo.commitment === undefined) throw new Error("note has no commitment; cannot persist it");
  return bigintHex(utxo.commitment);
}

export class CloakPersistenceError extends Error {
  override name = "CloakPersistenceError";
  constructor(
    message: string,
    /** The on-chain transaction succeeded; this is what to look up / recover from. */
    readonly signature: string
  ) {
    super(message);
  }
}
