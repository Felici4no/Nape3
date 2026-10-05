import { CloakPersistenceError, safeErrorMessage } from "@nape3/payments/cloak";
import { isUserRejection, type WalletHandle } from "./flow";
import type { IntentStore, ShieldIntent, ShieldProof } from "./shield-intent";

/**
 * One real Cloak shield from the user's own wallet, as an explicit state
 * machine. Framework-free so every path is unit-tested; the React view only
 * renders `ShieldView` and calls the actions.
 *
 *   WALLET_REQUIRED → WALLET_CONNECTED → BALANCE_VERIFIED → CLOAK_UNLOCK_REQUIRED
 *     → CLOAK_READY → SHIELD_PREPARED → USER_CONFIRMATION_REQUIRED
 *     → WALLET_SIGNATURE_REQUIRED → SUBMITTING → CONFIRMING → SHIELDED
 *   any step can end in FAILED (blocking or not, see ShieldFailure).
 *
 * Safety properties:
 *  - nothing is signed or sent without `confirm()`, reachable only from
 *    USER_CONFIRMATION_REQUIRED, and the wallet itself asks again;
 *  - `confirm()` leaves that state synchronously, so a double click is a no-op;
 *  - a durable intent is written before signing and read before every attempt:
 *    refreshes, second tabs and retries cannot create a second shield while one
 *    is unresolved;
 *  - nothing here retries a shield by itself.
 */

export type ShieldState =
  | "WALLET_REQUIRED"
  | "WALLET_CONNECTED"
  | "BALANCE_VERIFIED"
  | "CLOAK_UNLOCK_REQUIRED"
  | "CLOAK_READY"
  | "SHIELD_PREPARED"
  | "USER_CONFIRMATION_REQUIRED"
  | "WALLET_SIGNATURE_REQUIRED"
  | "SUBMITTING"
  | "CONFIRMING"
  | "SHIELDED"
  | "FAILED";

export const SHIELD_AMOUNT_USDC = 1_000_000n;
/** Network fees plus lookup-table rent the Cloak deposit may need. An estimate, not a quote. */
export const SOL_RECOMMENDED_LAMPORTS = 10_000_000n;

/** Wallet side of the Cloak funding layer, available once the user signed the derivation message. */
export interface ShieldFunding {
  shieldedUsdc(): Promise<bigint>;
  shield(amount: bigint, options: { onProgress: (stage: string) => void }): Promise<{ signature: string }>;
  /** Re-checks local notes against chain nullifiers; returns the shielded total. */
  reconcile(): Promise<bigint>;
}

export interface ShieldDeps {
  connectWallet(options: { silent: boolean }): Promise<WalletHandle>;
  readPublicBalances(address: string): Promise<{ publicUsdc: bigint; solLamports: bigint }>;
  /** Prompts the wallet to sign the derivation message (not a transaction). */
  unlock(wallet: WalletHandle): Promise<ShieldFunding>;
  readTransaction(signature: string): Promise<{ slot: number; blockTime: number | null } | null>;
  intents: IntentStore;
  /** "rpc-fast" when the configured RPC is RPC Fast, otherwise "custom". */
  provider: string;
  now(): Date;
  newId(): string;
  sleep?(ms: number): Promise<void>;
}

export interface ShieldSummary {
  network: "mainnet-beta";
  wallet: string;
  operation: "Cloak shield";
  amountUsdc: string;
  publicUsdc: string;
  solBalance: string;
  /** Estimate of the SOL needed for network fees and lookup-table rent. */
  solRecommended: string;
}

export interface ShieldFailure {
  code: string;
  message: string;
  /**
   * true: a transaction may have landed (or the record is unreadable), so a new
   * shield is refused until `checkPending()` proves otherwise.
   */
  blocking: boolean;
}

export interface ShieldView {
  state: ShieldState;
  history: ShieldState[];
  wallet: WalletHandle | null;
  publicUsdc: bigint | null;
  solLamports: bigint | null;
  shieldedUsdc: bigint | null;
  summary: ShieldSummary | null;
  /** Human text for what is happening now. */
  stage: string | null;
  notice: string | null;
  failure: ShieldFailure | null;
  proof: ShieldProof | null;
}

export function formatUsdc6(units: bigint): string {
  const s = units.toString().padStart(7, "0");
  return `${s.slice(0, -6)}.${s.slice(-6)}`;
}

export function formatSol9(lamports: bigint): string {
  const s = lamports.toString().padStart(10, "0");
  return `${s.slice(0, -9)}.${s.slice(-9)}`;
}

/** Error text for display: no URLs (an RPC URL carries the API key), no long hex/base64 payloads. */
export function displayError(error: unknown): string {
  return safeErrorMessage(error).replace(/\b(?:https?|wss?):\/\/\S+/gi, "[url]");
}

const WAIT_TRIES = 20;
const WAIT_MS = 2_000;

export class ShieldOperation {
  private view: ShieldView;
  private funding: ShieldFunding | null = null;
  private shieldedBefore: bigint | null = null;
  private running = false;
  private readonly listeners = new Set<(view: ShieldView) => void>();

  constructor(
    private readonly deps: ShieldDeps,
    private readonly amount: bigint = SHIELD_AMOUNT_USDC
  ) {
    this.view = {
      state: "WALLET_REQUIRED",
      history: ["WALLET_REQUIRED"],
      wallet: null,
      publicUsdc: null,
      solLamports: null,
      shieldedUsdc: null,
      summary: null,
      stage: null,
      notice: null,
      failure: null,
      proof: null
    };
  }

  get state(): ShieldView {
    return this.view;
  }

  subscribe(listener: (view: ShieldView) => void): () => void {
    this.listeners.add(listener);
    listener(this.view);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<ShieldView>) {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener(this.view);
  }

  /** Synchronous: callers rely on there being no await between a state check and the move. */
  private go(state: ShieldState, stage: string | null = null, patch: Partial<ShieldView> = {}) {
    this.set({ ...patch, state, stage, history: [...this.view.history, state] });
  }

  private fail(failure: ShieldFailure) {
    this.go("FAILED", null, { failure, notice: null });
  }

  /** Runs one user action at a time; a second call while one runs is ignored. */
  private async exclusive(fn: () => Promise<void>): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await fn();
    } finally {
      this.running = false;
    }
  }

  // ------------------------------------------------------------------ connect

  /** Connects the wallet, loads any earlier attempt, and verifies balances. `silent` only reconnects a trusted site. */
  async connect(silent = false): Promise<void> {
    if (this.view.state !== "WALLET_REQUIRED") return;
    await this.exclusive(async () => {
      let wallet: WalletHandle;
      try {
        wallet = await this.deps.connectWallet({ silent });
      } catch (error) {
        if (!silent) this.set({ notice: isUserRejection(error) ? "Connection cancelled." : `Could not connect the wallet: ${displayError(error)}` });
        return;
      }
      this.go("WALLET_CONNECTED", null, { wallet, notice: null, failure: null });
      let pending: ShieldIntent | null;
      try {
        pending = this.deps.intents.read(wallet.address);
      } catch {
        this.fail({
          code: "record-unreadable",
          message: "Could not read the record of earlier shield attempts, so a new one is refused. Check your wallet history, then clear this site's data only if you are sure no shield is pending.",
          blocking: true
        });
        return;
      }
      if (pending) {
        this.enterPending(pending);
        return;
      }
      await this.verifyBalances();
    });
  }

  disconnect(): void {
    if (this.running) return;
    this.funding = null;
    this.shieldedBefore = null;
    this.go("WALLET_REQUIRED", null, { wallet: null, publicUsdc: null, solLamports: null, shieldedUsdc: null, summary: null, failure: null, notice: null, proof: null });
  }

  // ------------------------------------------------------------------ balances

  private async verifyBalances(): Promise<void> {
    const wallet = this.view.wallet!;
    let balances: { publicUsdc: bigint; solLamports: bigint };
    try {
      balances = await this.deps.readPublicBalances(wallet.address);
    } catch (error) {
      this.fail({ code: "balance-read-failed", message: `Could not read balances: ${displayError(error)}`, blocking: false });
      return;
    }
    this.set({ publicUsdc: balances.publicUsdc, solLamports: balances.solLamports });
    if (balances.publicUsdc < this.amount) {
      this.fail({ code: "insufficient-usdc", message: `Needs ${formatUsdc6(this.amount)} USDC in this wallet; it has ${formatUsdc6(balances.publicUsdc)}.`, blocking: false });
      return;
    }
    if (balances.solLamports < SOL_RECOMMENDED_LAMPORTS) {
      this.fail({
        code: "insufficient-sol",
        message: `Needs about ${formatSol9(SOL_RECOMMENDED_LAMPORTS)} SOL for network fees and lookup-table rent; it has ${formatSol9(balances.solLamports)}.`,
        blocking: false
      });
      return;
    }
    this.go("BALANCE_VERIFIED");
    this.go("CLOAK_UNLOCK_REQUIRED");
  }

  // ------------------------------------------------------------------ unlock

  /** One wallet signature over the fixed derivation message; it is not a transaction. */
  async unlock(): Promise<void> {
    if (this.view.state !== "CLOAK_UNLOCK_REQUIRED") return;
    await this.exclusive(async () => {
      this.set({ stage: "Sign once in your wallet to unlock your private balance (not a transaction)…", notice: null });
      try {
        this.funding = await this.deps.unlock(this.view.wallet!);
        this.shieldedBefore = await this.funding.shieldedUsdc();
      } catch (error) {
        this.set({
          stage: null,
          notice: isUserRejection(error) ? "Signature cancelled. It is needed once to unlock your private balance." : `Could not unlock: ${displayError(error)}`
        });
        return;
      }
      this.go("CLOAK_READY", null, { shieldedUsdc: this.shieldedBefore });
    });
  }

  // ------------------------------------------------------------------ prepare

  /** Re-reads balances and the attempt record, then shows the summary and stops for the user. */
  async prepare(): Promise<void> {
    if (this.view.state !== "CLOAK_READY") return;
    await this.exclusive(async () => {
      const wallet = this.view.wallet!;
      try {
        const pending = this.deps.intents.read(wallet.address);
        if (pending) {
          this.enterPending(pending);
          return;
        }
      } catch {
        this.fail({ code: "record-unreadable", message: "Could not read the record of earlier shield attempts, so a new one is refused.", blocking: true });
        return;
      }
      let balances: { publicUsdc: bigint; solLamports: bigint };
      try {
        balances = await this.deps.readPublicBalances(wallet.address);
      } catch (error) {
        this.fail({ code: "balance-read-failed", message: `Could not read balances: ${displayError(error)}`, blocking: false });
        return;
      }
      this.set({ publicUsdc: balances.publicUsdc, solLamports: balances.solLamports });
      if (balances.publicUsdc < this.amount || balances.solLamports < SOL_RECOMMENDED_LAMPORTS) {
        this.fail({ code: "balance-changed", message: "Balances changed and no longer cover this shield. Check them again.", blocking: false });
        return;
      }
      const summary: ShieldSummary = {
        network: "mainnet-beta",
        wallet: wallet.address,
        operation: "Cloak shield",
        amountUsdc: formatUsdc6(this.amount),
        publicUsdc: formatUsdc6(balances.publicUsdc),
        solBalance: formatSol9(balances.solLamports),
        solRecommended: formatSol9(SOL_RECOMMENDED_LAMPORTS)
      };
      this.go("SHIELD_PREPARED", null, { summary });
      this.go("USER_CONFIRMATION_REQUIRED", "Review the summary. Nothing is sent until you confirm here and approve in your wallet.");
    });
  }

  /** Back out of the confirmation: nothing was signed or sent. */
  cancel(): void {
    if (this.running) return;
    if (this.view.state !== "USER_CONFIRMATION_REQUIRED" && this.view.state !== "SHIELD_PREPARED") return;
    this.go("CLOAK_READY", null, { summary: null, notice: "Cancelled. Nothing was signed or sent." });
  }

  // ------------------------------------------------------------------ confirm

  /**
   * The only call that can move funds. Leaves USER_CONFIRMATION_REQUIRED
   * synchronously, so a second click finds another state and does nothing.
   */
  async confirm(): Promise<void> {
    if (this.view.state !== "USER_CONFIRMATION_REQUIRED" || this.running || !this.funding) return;
    this.running = true;
    const wallet = this.view.wallet!;
    const funding = this.funding;
    this.go("WALLET_SIGNATURE_REQUIRED", "Generating the proof, then approve in your wallet…", { notice: null });
    let intent: ShieldIntent;
    try {
      const pending = this.deps.intents.read(wallet.address);
      if (pending) {
        this.enterPending(pending);
        this.running = false;
        return;
      }
      intent = {
        id: this.deps.newId(),
        amountUsdc: this.amount.toString(),
        status: "signing",
        startedAt: this.deps.now().toISOString(),
        publicUsdcBefore: (this.view.publicUsdc ?? 0n).toString()
      };
      this.deps.intents.write(wallet.address, intent);
    } catch {
      this.fail({ code: "record-unwritable", message: "Could not save the attempt record, so nothing was signed. No funds moved.", blocking: false });
      this.running = false;
      return;
    }

    const onProgress = (stage: string) => {
      if (/wallet signature/i.test(stage) && /lookup table/i.test(stage)) {
        this.go("WALLET_SIGNATURE_REQUIRED", "Approve the lookup-table transaction in your wallet. It only prepares accounts; no USDC moves yet.");
      } else if (/^waiting for wallet signature/i.test(stage)) {
        this.go("WALLET_SIGNATURE_REQUIRED", `Approve the ${formatUsdc6(this.amount)} USDC shield in your wallet.`);
      } else if (/^sending transaction/i.test(stage)) {
        intent = { ...intent, status: "sent" };
        try {
          this.deps.intents.write(wallet.address, intent);
        } catch {
          /* the "signing" record already blocks a second attempt */
        }
        this.go("SUBMITTING", "Sent to the network.");
      } else if (/^confirming transaction/i.test(stage)) {
        this.go("CONFIRMING", "Waiting for the network to confirm…");
      }
    };

    try {
      const result = await funding.shield(this.amount, { onProgress });
      await this.finish(wallet, intent, result.signature, funding);
    } catch (error) {
      this.onShieldError(wallet, intent, error);
    } finally {
      this.running = false;
    }
  }

  private async finish(wallet: WalletHandle, intent: ShieldIntent, signature: string, funding: ShieldFunding): Promise<void> {
    this.go("CONFIRMING", "Confirmed. Recording the proof and reconciling your private balance…");
    // Durable before anything that can throw: from here a retry is refused.
    const base: ShieldProof = {
      network: "mainnet-beta",
      provider: this.deps.provider,
      operation: "cloak-shield",
      amountUsdc: formatUsdc6(this.amount),
      walletAddress: wallet.address,
      signature,
      slot: null,
      confirmedAt: this.deps.now().toISOString()
    };
    this.safeWrite(wallet.address, { ...intent, status: "done", proof: base });

    const tx = await this.waitForTransaction(signature);
    const proof: ShieldProof = tx
      ? { ...base, slot: tx.slot, confirmedAt: tx.blockTime !== null ? new Date(tx.blockTime * 1000).toISOString() : base.confirmedAt }
      : base;
    this.safeWrite(wallet.address, { ...intent, status: "done", proof });

    let notice: string | null = tx ? null : "Confirmed on chain, but the RPC did not return the transaction yet; slot is unknown.";
    let shieldedAfter: bigint | null = null;
    try {
      shieldedAfter = await funding.reconcile();
      if (this.shieldedBefore !== null && shieldedAfter - this.shieldedBefore !== this.amount) {
        notice = `Private balance moved by ${formatUsdc6(shieldedAfter - this.shieldedBefore)}, not ${formatUsdc6(this.amount)}. Check the transaction before doing anything else.`;
      }
    } catch (error) {
      notice = `Shielded, but reconciling the private balance failed: ${displayError(error)}`;
    }
    this.go("SHIELDED", null, { proof, shieldedUsdc: shieldedAfter ?? this.view.shieldedUsdc, notice });
  }

  private async waitForTransaction(signature: string): Promise<{ slot: number; blockTime: number | null } | null> {
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let i = 0; i < WAIT_TRIES; i++) {
      try {
        const tx = await this.deps.readTransaction(signature);
        if (tx) return tx;
      } catch {
        /* keep waiting: the shield already confirmed */
      }
      await sleep(WAIT_MS);
    }
    return null;
  }

  private safeWrite(address: string, intent: ShieldIntent) {
    try {
      this.deps.intents.write(address, intent);
    } catch {
      /* the proof is still shown; the earlier record keeps blocking a second attempt */
    }
  }

  private onShieldError(wallet: WalletHandle, intent: ShieldIntent, error: unknown) {
    if (error instanceof CloakPersistenceError) {
      // Confirmed on chain, but the notes were not saved: never retry.
      this.safeWrite(wallet.address, { ...intent, status: "sent", signature: error.signature });
      this.fail({ code: "notes-not-saved", message: `${displayError(error)} Signature: ${error.signature}`, blocking: true });
      return;
    }
    if (intent.status === "signing") {
      // Nothing was broadcast (cancelled in the wallet, proof or RPC error before sending).
      try {
        this.deps.intents.clear(wallet.address);
      } catch {
        /* a leftover "signing" record is resolved by checkPending() */
      }
      this.fail({
        code: isUserRejection(error) ? "rejected" : "failed-before-broadcast",
        message: isUserRejection(error) ? "Cancelled in the wallet. Nothing left your wallet." : `Shield failed before anything was sent: ${displayError(error)}`,
        blocking: false
      });
      return;
    }
    this.fail({
      code: "outcome-unknown",
      message: `The shield may have landed: ${displayError(error)} Do not retry. Use "Check on chain" to find out.`,
      blocking: true
    });
  }

  // ------------------------------------------------------------------ unresolved attempts

  private enterPending(intent: ShieldIntent) {
    if (intent.status === "done" && intent.proof) {
      this.go("SHIELDED", null, { proof: intent.proof, notice: "A shield from this wallet was already completed. Nothing new was sent.", failure: null });
      return;
    }
    this.fail({
      code: "attempt-unresolved",
      message: "An earlier shield attempt from this wallet is unresolved, so a new one is refused. Use “Check on chain” to find out whether it landed.",
      blocking: true
    });
  }

  /**
   * Resolves a blocking failure from chain evidence: public USDC unchanged
   * means the earlier attempt did not land (safe to start over); down by
   * exactly the amount means it did (never retry); anything else stays blocked.
   */
  async checkPending(): Promise<void> {
    if (this.view.state !== "FAILED" || !this.view.failure?.blocking || !this.view.wallet) return;
    await this.exclusive(async () => {
      const wallet = this.view.wallet!;
      let intent: ShieldIntent | null;
      let now: { publicUsdc: bigint };
      try {
        intent = this.deps.intents.read(wallet.address);
        now = await this.deps.readPublicBalances(wallet.address);
      } catch (error) {
        this.set({ notice: `Could not check: ${displayError(error)}` });
        return;
      }
      if (!intent) {
        await this.restart("No earlier attempt is on record. You can start over.");
        return;
      }
      if (intent.signature) {
        this.set({ notice: `The transaction ${intent.signature} is confirmed. Do not retry; recover the notes with this wallet's Cloak key.` });
        return;
      }
      const before = BigInt(intent.publicUsdcBefore);
      const amount = BigInt(intent.amountUsdc);
      if (now.publicUsdc === before) {
        this.deps.intents.clear(wallet.address);
        await this.restart("The earlier attempt did not land: your public USDC is unchanged. You can start over.");
      } else if (before - now.publicUsdc === amount) {
        this.set({ notice: `Public USDC dropped by ${formatUsdc6(amount)}: the earlier shield landed. Do not retry; the notes are recoverable from chain with this wallet's Cloak key.` });
      } else {
        this.set({ notice: "Public USDC changed by an amount that does not explain the attempt. Check your wallet history before doing anything else." });
      }
    });
  }

  /** Starts the checks again from the connected wallet. Callers hold the exclusive lock. */
  private async restart(notice: string | null): Promise<void> {
    this.funding = null;
    this.shieldedBefore = null;
    this.go("WALLET_REQUIRED", null, { summary: null, failure: null, notice, proof: null });
    if (this.view.wallet) {
      this.go("WALLET_CONNECTED");
      await this.verifyBalances();
    }
  }

  /** Leaves a non-blocking failure ("Check again"). A blocking failure cannot be reset, only resolved by checkPending(). */
  async reset(): Promise<void> {
    if (this.view.state !== "FAILED" || this.view.failure?.blocking) return;
    await this.exclusive(() => this.restart(null));
  }

  /** After SHIELDED: explicitly allows another shield. Clears the finished record. */
  async startAnother(): Promise<void> {
    if (this.view.state !== "SHIELDED" || !this.view.wallet) return;
    await this.exclusive(async () => {
      try {
        this.deps.intents.clear(this.view.wallet!.address);
      } catch {
        return;
      }
      await this.restart("Ready for another shield.");
    });
  }
}
