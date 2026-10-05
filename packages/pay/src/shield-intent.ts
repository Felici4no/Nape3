/**
 * Durable record of ONE shield attempt per wallet. It is written before the
 * wallet is asked to sign and is only removed when the attempt provably did not
 * move funds, so a double click, a refresh, a second tab or a retry button can
 * never start a second shield while the first one is unresolved.
 *
 * It holds public data only: no signatures over messages, no notes, no keys.
 */

/** Safe proof metadata of a confirmed shield. */
export interface ShieldProof {
  network: "mainnet-beta";
  provider: string;
  operation: "cloak-shield";
  amountUsdc: string;
  walletAddress: string;
  signature: string;
  /** null only if the RPC could not return the transaction within the wait window. */
  slot: number | null;
  confirmedAt: string;
}

export interface ShieldIntent {
  id: string;
  /** Base units, decimal string. */
  amountUsdc: string;
  /**
   * signing: proof/approval in progress, nothing broadcast yet.
   * sent:    the signed transaction was handed to the RPC; it may have landed.
   * done:    confirmed; `proof` is set.
   */
  status: "signing" | "sent" | "done";
  startedAt: string;
  /** Public USDC base units before the attempt; lets a later check tell "landed" from "did not". */
  publicUsdcBefore: string;
  /** Set when the transaction confirmed but the local notes could not be saved. */
  signature?: string;
  proof?: ShieldProof;
}

/**
 * Synchronous on purpose: check-and-write has no await in between, so two
 * clicks in the same tab cannot interleave. Methods throw when storage is
 * unavailable, and the caller fails closed (no signing without a durable record).
 */
export interface IntentStore {
  read(wallet: string): ShieldIntent | null;
  write(wallet: string, intent: ShieldIntent): void;
  clear(wallet: string): void;
}

export class MemoryIntentStore implements IntentStore {
  private readonly map = new Map<string, ShieldIntent>();
  read(wallet: string) {
    const v = this.map.get(wallet);
    return v ? { ...v } : null;
  }
  write(wallet: string, intent: ShieldIntent) {
    this.map.set(wallet, { ...intent });
  }
  clear(wallet: string) {
    this.map.delete(wallet);
  }
}

export class LocalIntentStore implements IntentStore {
  private key(wallet: string) {
    return `upay3food.shield.intent.${wallet}`;
  }
  read(wallet: string): ShieldIntent | null {
    const raw = localStorage.getItem(this.key(wallet));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as ShieldIntent;
    if (!parsed || typeof parsed.id !== "string" || !["signing", "sent", "done"].includes(parsed.status)) {
      throw new Error("unreadable shield record");
    }
    return parsed;
  }
  write(wallet: string, intent: ShieldIntent): void {
    localStorage.setItem(this.key(wallet), JSON.stringify(intent));
    if (localStorage.getItem(this.key(wallet)) !== JSON.stringify(intent)) throw new Error("shield record was not saved");
  }
  clear(wallet: string): void {
    localStorage.removeItem(this.key(wallet));
  }
}
