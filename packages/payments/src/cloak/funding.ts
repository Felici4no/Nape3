import { CLOAK_PROGRAM_ID, type Address, type CloakRpc, type TransactResult, type Utxo } from "@cloak.dev/sdk";
import { CloakKeys } from "./keys";
import { cloakOptions, signerAddress, type CloakSdkPort, type CloakSigner } from "./port";
import { createCloakLogger, safeErrorMessage, type CloakLogger } from "./redact";
import {
  bigintHex,
  CloakPersistenceError,
  commitmentHex,
  fromBase64,
  toBase64,
  type NoteStore,
  type StoredNote
} from "./store";
import { assertShieldable, cloakWithdrawFee, grossUpWithdrawal, type UsdcUnits } from "./units";

/**
 * Private funding layer: the user's purchase money sits in the Cloak USDC
 * pool and leaves it only to pay the off-ramp. On-chain, the off-ramp deposit
 * comes from the Cloak pool — not from the user's public wallet.
 *
 * Invariants:
 *  - amounts are bigint base units end to end;
 *  - every output note is persisted and read back BEFORE a call resolves;
 *  - notes chosen for a spend are marked `pending-spend` before submission;
 *  - logs carry signatures, public amounts and counts only.
 */

export interface CloakFundingDeps {
  sdk: CloakSdkPort;
  connection: CloakRpc;
  signer: CloakSigner;
  keys: CloakKeys;
  store: NoteStore;
  /** Pool mint (USDC on mainnet). */
  mint: Address;
  log?: CloakLogger;
  now?: () => Date;
  explorerUrl?: (signature: string) => string;
}

export interface ShieldedBalance {
  mint: string;
  total: UsdcUnits;
  notes: number;
  pending: number;
}

export interface ShieldOptions {
  /** SDK stage text ("Waiting for wallet signature...", "Confirming transaction..."). Public, never contains secrets. */
  onProgress?: (stage: string) => void;
  /** Existing address lookup tables to use instead of creating one (e.g. a simulate-only rerun). */
  lookupTables?: string[];
  /** Transaction message version for the deposit: 1 = Transaction V1 (no lookup tables, 4,096-byte packet). Default 0. */
  transactionVersion?: 0 | 1;
}

export interface ShieldResult {
  signature: string;
  explorer: string;
  amount: UsdcUnits;
  balance: ShieldedBalance;
}

export interface FundingResult {
  signature: string;
  explorer: string;
  /** Leaves the pool (fee included). */
  gross: UsdcUnits;
  /** Received by the recipient (off-ramp deposit address). */
  net: UsdcUnits;
  fee: UsdcUnits;
  /** Change that stays shielded. */
  change: UsdcUnits;
  balance: ShieldedBalance;
}

export class InsufficientShieldedBalanceError extends Error {
  override name = "InsufficientShieldedBalanceError";
  constructor(
    readonly required: UsdcUnits,
    readonly available: UsdcUnits
  ) {
    super(`shielded balance ${available} < required ${required} (base units)`);
  }
}

export const SOLSCAN = (signature: string) => `https://solscan.io/tx/${signature}`;

export class CloakFunding {
  private readonly log: CloakLogger;
  private readonly now: () => Date;
  private readonly explorer: (signature: string) => string;

  constructor(private readonly deps: CloakFundingDeps) {
    this.log = deps.log ?? createCloakLogger();
    this.now = deps.now ?? (() => new Date());
    this.explorer = deps.explorerUrl ?? SOLSCAN;
  }

  get walletAddress(): Address {
    return signerAddress(this.deps.signer);
  }

  // ---------------------------------------------------------------- balance

  private async notesOfMint(): Promise<StoredNote[]> {
    return (await this.deps.store.load()).filter((n) => n.mint === this.deps.mint);
  }

  async shieldedBalance(): Promise<ShieldedBalance> {
    const notes = await this.notesOfMint();
    const unspent = notes.filter((n) => n.status === "unspent");
    return {
      mint: this.deps.mint,
      total: unspent.reduce((sum, n) => sum + BigInt(n.amount), 0n),
      notes: unspent.length,
      pending: notes.filter((n) => n.status === "pending-spend").length
    };
  }

  /**
   * Re-checks local notes against on-chain nullifiers (a note may have been
   * spent from another device). Marks spent ones; returns the fresh balance.
   */
  async reconcileWithChain(): Promise<ShieldedBalance> {
    const all = await this.deps.store.load();
    const mine = all.filter((n) => n.mint === this.deps.mint && n.status !== "spent");
    if (mine.length > 0) {
      const utxos = await Promise.all(mine.map((n) => this.restore(n)));
      const { spent } = await this.deps.sdk.verifyUtxos(utxos, this.deps.connection, CLOAK_PROGRAM_ID);
      const spentIds = new Set(spent.map((u) => commitmentHex(u)));
      const next = all.map((n) =>
        spentIds.has(n.id) ? { ...n, status: "spent" as const } : n.status === "pending-spend" ? { ...n, status: "unspent" as const } : n
      );
      await this.deps.store.save(next);
      this.log("balance.reconciled", { notes: mine.length, outputs: spentIds.size });
    }
    return this.shieldedBalance();
  }

  // ---------------------------------------------------------------- persistence

  private async toStored(utxo: Utxo, createdBy: string): Promise<StoredNote> {
    if (utxo.index === undefined) throw new Error("output note has no leaf index");
    const commitment = utxo.commitment ?? (await this.deps.sdk.computeUtxoCommitment(utxo));
    return {
      id: bigintHex(commitment),
      mint: utxo.mintAddress,
      amount: utxo.amount.toString(),
      serialized: toBase64(this.deps.sdk.serializeUtxo(utxo)),
      index: utxo.index,
      ...(utxo.siblingCommitment !== undefined ? { siblingCommitment: bigintHex(utxo.siblingCommitment) } : {}),
      status: "unspent",
      createdBy,
      createdAt: this.now().toISOString()
    };
  }

  /** Restores a spendable Utxo, including the fields serializeUtxo drops. */
  private async restore(note: StoredNote): Promise<Utxo> {
    const utxo = await this.deps.sdk.deserializeUtxo(fromBase64(note.serialized));
    utxo.index = note.index;
    if (note.siblingCommitment) utxo.siblingCommitment = BigInt(`0x${note.siblingCommitment}`);
    if (utxo.commitment === undefined || bigintHex(utxo.commitment) !== note.id) {
      throw new Error(`stored note ${note.id.slice(0, 12)}… does not match its commitment`);
    }
    return utxo;
  }

  /**
   * Persists the non-zero outputs of `result` and marks `spentIds` as spent,
   * then reads the store back to prove the notes are durable. Throws
   * CloakPersistenceError (carrying the signature) if any of that fails — the
   * caller must NOT report success in that case.
   */
  private async persistOutputs(result: TransactResult, spentIds: ReadonlySet<string>): Promise<void> {
    const outputs = (result.outputUtxos ?? []).filter((u) => u.amount > 0n);
    try {
      const fresh = await Promise.all(outputs.map((u) => this.toStored(u, result.signature)));
      const current = await this.deps.store.load();
      const freshIds = new Set(fresh.map((n) => n.id));
      const next = [
        ...current
          .filter((n) => !freshIds.has(n.id))
          .map((n) => (spentIds.has(n.id) ? { ...n, status: "spent" as const, spentBy: result.signature } : n)),
        ...fresh
      ];
      await this.deps.store.save(next);
      const reread = new Map((await this.deps.store.load()).map((n) => [n.id, n]));
      for (const note of fresh) {
        if (reread.get(note.id)?.serialized !== note.serialized) throw new Error("read-back mismatch");
      }
    } catch (error) {
      this.log("notes.persist_failed", { signature: result.signature, outputs: outputs.length, error: safeErrorMessage(error) });
      throw new CloakPersistenceError(
        "Transaction confirmed but its output notes could not be saved. Do not retry. " +
          "The notes are recoverable from chain with this wallet's Cloak key (scan + recover).",
        result.signature
      );
    }
    this.log("notes.persisted", { signature: result.signature, outputs: outputs.length });
  }

  // ---------------------------------------------------------------- shield

  /** Public wallet → Cloak USDC pool. The deposit itself is visible; what follows is not linked to it. */
  async shield(amount: UsdcUnits, options: ShieldOptions = {}): Promise<ShieldResult> {
    assertShieldable(amount);
    const { sdk, keys, signer } = this.deps;
    const nk = keys.viewingKeyNk();
    const { utxo, noteSalt } = await sdk.createRecoverableDepositUtxo(amount, nk, this.deps.mint);
    this.log("shield.start", { amount, mint: this.deps.mint });
    const result = await sdk.transact(
      {
        inputUtxos: [await sdk.createZeroUtxo(this.deps.mint)],
        outputUtxos: [utxo],
        externalAmount: amount,
        depositor: signerAddress(signer)
      },
      cloakOptions(this.deps.connection, signer, nk, {
        chainNoteSalt: noteSalt,
        // A wallet re-proves and re-asks for approval on every stale-root retry (up to 40 by
        // default). A shield never retries by itself: a failure is surfaced and the user decides.
        ...(signer.kind === "wallet" ? { maxRootRetries: 0 } : {}),
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        ...(options.lookupTables?.length ? { altAddresses: options.lookupTables } : {}),
        ...(options.transactionVersion !== undefined ? { transactionVersion: options.transactionVersion } : {})
      })
    );
    await this.persistOutputs(result, new Set());
    const balance = await this.shieldedBalance();
    this.log("shield.done", { signature: result.signature, amount, balance: balance.total });
    return { signature: result.signature, explorer: this.explorer(result.signature), amount, balance };
  }

  // ---------------------------------------------------------------- fund

  /** Up to two unspent notes (2-in circuit) covering `required`, largest first. */
  private async selectNotes(required: UsdcUnits): Promise<StoredNote[]> {
    const unspent = (await this.notesOfMint())
      .filter((n) => n.status === "unspent")
      .sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : -1));
    const available = unspent.reduce((sum, n) => sum + BigInt(n.amount), 0n);
    for (const first of unspent) {
      if (BigInt(first.amount) >= required) return [first];
    }
    for (let i = 0; i < unspent.length; i++) {
      for (let j = i + 1; j < unspent.length; j++) {
        if (BigInt(unspent[i]!.amount) + BigInt(unspent[j]!.amount) >= required) return [unspent[i]!, unspent[j]!];
      }
    }
    throw new InsufficientShieldedBalanceError(required, available);
  }

  private async markStatus(ids: ReadonlySet<string>, status: StoredNote["status"]) {
    const notes = await this.deps.store.load();
    await this.deps.store.save(notes.map((n) => (ids.has(n.id) ? { ...n, status } : n)));
  }

  /**
   * Shielded pool → `recipient` (the off-ramp's deposit address) so that it
   * receives at least `net`. Change stays shielded and is persisted before
   * this resolves.
   */
  async fundPayment(recipient: Address, net: UsdcUnits): Promise<FundingResult> {
    const gross = grossUpWithdrawal(net);
    const fee = cloakWithdrawFee(gross);
    const chosen = await this.selectNotes(gross);
    const ids = new Set(chosen.map((n) => n.id));
    const inputs = await Promise.all(chosen.map((n) => this.restore(n)));
    const inputTotal = inputs.reduce((sum, u) => sum + u.amount, 0n);

    await this.markStatus(ids, "pending-spend");
    this.log("fund.start", { gross, net, fee, inputs: inputs.length, recipient });
    let result: TransactResult;
    try {
      result = await this.deps.sdk.partialWithdraw(
        inputs,
        recipient,
        gross,
        cloakOptions(this.deps.connection, this.deps.signer, this.deps.keys.viewingKeyNk())
      );
    } catch (error) {
      // Not submitted (or rejected): release the notes. If the outcome is unknown,
      // reconcileWithChain() will mark them spent from on-chain nullifiers.
      await this.markStatus(ids, "unspent");
      this.log("fund.failed", { error: safeErrorMessage(error) });
      throw error;
    }
    await this.persistOutputs(result, ids);
    const balance = await this.shieldedBalance();
    this.log("fund.done", { signature: result.signature, gross, net, balance: balance.total });
    return {
      signature: result.signature,
      explorer: this.explorer(result.signature),
      gross,
      net,
      fee,
      change: inputTotal - gross,
      balance
    };
  }
}
