/**
 * Read-only diagnosis of a failed /shield attempt. Only RPC reads: balances,
 * the wallet's latest signatures, the transactions behind them and the
 * address lookup table account. It never signs, sends, retries or touches the
 * shield intent record.
 */

export const CLOAK_PROGRAM_ID = "zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW";
export const ALT_PROGRAM_ID = "AddressLookupTab1e1111111111111111111111111";
export const U64_MAX = "18446744073709551615";

export type RpcCall = <T>(method: string, params: unknown[]) => Promise<T>;

export interface SignatureSummary {
  signature: string;
  slot: number;
  blockTime: number | null;
  failed: boolean;
  /** Top-level programs invoked. */
  programs: string[];
  kind: "lookup-table" | "cloak" | "other" | "unknown";
  /** For lookup-table transactions: the table and what was done to it. */
  lookupTable?: { address: string; actions: string[] };
}

export interface LookupTableState {
  address: string;
  exists: boolean;
  owner: string | null;
  /** Lamports held by the table account (rent recoverable by closing it). */
  lamports: bigint | null;
  addresses: string[];
  authority: string | null;
  deactivationSlot: string | null;
  lastExtendedSlot: number | null;
  lastExtendedSlotStartIndex: number | null;
  /** Not deactivated. */
  active: boolean;
  /**
   * Addresses added at `lastExtendedSlot` are usable only in later slots.
   * true when the diagnosis' current slot is past it.
   */
  warmedUp: boolean | null;
}

export interface ShieldChainDiagnosis {
  wallet: string;
  currentSlot: number;
  publicUsdc: bigint;
  solLamports: bigint;
  signatures: SignatureSummary[];
  /** Most recent lookup-table transaction and its table (kept for display). */
  lookupTableTransaction: SignatureSummary | null;
  lookupTable: LookupTableState | null;
  /** Every table created/extended by this wallet's recent transactions, newest first. */
  lookupTables: LookupTableState[];
  /** Signatures of transactions that invoked the Cloak program (a shield/deposit would be one). */
  cloakTransactions: string[];
}

interface ParsedInstruction {
  programId?: string;
  parsed?: { type?: string; info?: Record<string, unknown> };
}

interface ParsedTransaction {
  slot: number;
  blockTime: number | null;
  meta: { err: unknown } | null;
  transaction: { message: { instructions: ParsedInstruction[] } };
}

function summarize(signature: string, slot: number, blockTime: number | null, tx: ParsedTransaction | null, statusErr: unknown): SignatureSummary {
  if (!tx) return { signature, slot, blockTime, failed: statusErr != null, programs: [], kind: "unknown" };
  const instructions = tx.transaction.message.instructions;
  const programs = [...new Set(instructions.map((i) => i.programId ?? "?"))];
  const altIxs = instructions.filter((i) => i.programId === ALT_PROGRAM_ID);
  const tableAddress = altIxs.map((i) => i.parsed?.info?.lookupTableAccount).find((a): a is string => typeof a === "string");
  const kind: SignatureSummary["kind"] = programs.includes(CLOAK_PROGRAM_ID) ? "cloak" : altIxs.length ? "lookup-table" : "other";
  return {
    signature,
    slot,
    blockTime,
    failed: tx.meta?.err != null,
    programs,
    kind,
    ...(tableAddress ? { lookupTable: { address: tableAddress, actions: altIxs.map((i) => i.parsed?.type ?? "unknown") } } : {})
  };
}

export async function readLookupTable(rpc: RpcCall, tableAddress: string, currentSlot: number): Promise<LookupTableState> {
  const result = await rpc<{ value: { owner: string; lamports?: number; data: { parsed?: { info?: Record<string, unknown> } } } | null }>("getAccountInfo", [
    tableAddress,
    { encoding: "jsonParsed", commitment: "confirmed" }
  ]);
  const account = result.value;
  if (!account) {
    return { address: tableAddress, exists: false, owner: null, lamports: null, addresses: [], authority: null, deactivationSlot: null, lastExtendedSlot: null, lastExtendedSlotStartIndex: null, active: false, warmedUp: null };
  }
  const info = account.data.parsed?.info ?? {};
  const lastExtendedSlot = info.lastExtendedSlot !== undefined ? Number(info.lastExtendedSlot) : null;
  const deactivationSlot = info.deactivationSlot !== undefined ? String(info.deactivationSlot) : null;
  return {
    address: tableAddress,
    exists: true,
    owner: account.owner,
    lamports: account.lamports !== undefined ? BigInt(account.lamports) : null,
    addresses: Array.isArray(info.addresses) ? (info.addresses as string[]) : [],
    authority: typeof info.authority === "string" ? info.authority : null,
    deactivationSlot,
    lastExtendedSlot,
    lastExtendedSlotStartIndex: info.lastExtendedSlotStartIndex !== undefined ? Number(info.lastExtendedSlotStartIndex) : null,
    active: deactivationSlot === U64_MAX,
    warmedUp: lastExtendedSlot === null ? null : currentSlot > lastExtendedSlot
  };
}

export async function diagnoseShieldChain(rpc: RpcCall, wallet: string, usdcMint: string, limit = 15): Promise<ShieldChainDiagnosis> {
  const [slot, sol, tokens, sigs] = await Promise.all([
    rpc<number>("getSlot", [{ commitment: "confirmed" }]),
    rpc<{ value: number }>("getBalance", [wallet, { commitment: "confirmed" }]),
    rpc<{ value: Array<{ account: { data: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }> }>("getTokenAccountsByOwner", [
      wallet,
      { mint: usdcMint },
      { encoding: "jsonParsed", commitment: "confirmed" }
    ]),
    rpc<Array<{ signature: string; slot: number; blockTime: number | null; err: unknown }>>("getSignaturesForAddress", [wallet, { limit, commitment: "confirmed" }])
  ]);
  let publicUsdc = 0n;
  for (const t of tokens.value) {
    const amount = t.account.data.parsed?.info?.tokenAmount?.amount;
    if (amount && /^\d+$/.test(amount)) publicUsdc += BigInt(amount);
  }
  const signatures: SignatureSummary[] = [];
  for (const s of sigs) {
    const tx = await rpc<ParsedTransaction | null>("getTransaction", [s.signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 1 }]).catch(() => null);
    signatures.push(summarize(s.signature, s.slot, s.blockTime, tx, s.err));
  }
  const lookupTableTransaction = signatures.find((s) => s.kind === "lookup-table" && s.lookupTable) ?? null;
  const tableAddresses = [...new Set(signatures.map((s) => s.lookupTable?.address).filter((a): a is string => !!a))];
  const lookupTables = await Promise.all(tableAddresses.map((a) => readLookupTable(rpc, a, slot)));
  const lookupTable = lookupTables.find((t) => t.address === lookupTableTransaction?.lookupTable?.address) ?? null;
  return {
    wallet,
    currentSlot: slot,
    publicUsdc,
    solLamports: BigInt(sol.value),
    signatures,
    lookupTableTransaction,
    lookupTable,
    lookupTables,
    cloakTransactions: signatures.filter((s) => s.kind === "cloak").map((s) => s.signature)
  };
}

// ---------------------------------------------------------------------------
// Reclaiming the rent of wallet-owned lookup tables (analysis only: nothing is sent)
// ---------------------------------------------------------------------------

/** A deactivated table can be closed once its deactivation slot has left the SlotHashes sysvar (512 slots). */
export const SLOT_HASHES_WINDOW = 512;

export interface AltCleanupStep {
  table: string;
  recoverableLamports: bigint | null;
  /** What the authority must sign next, if anything. */
  next: "deactivate" | "wait" | "close" | "none";
  detail: string;
}

export function altCleanupPlan(tables: readonly LookupTableState[], wallet: string, currentSlot: number): AltCleanupStep[] {
  return tables.map((t) => {
    const base = { table: t.address, recoverableLamports: t.lamports };
    if (!t.exists) return { ...base, next: "none" as const, detail: "already closed" };
    if (t.authority !== wallet) return { ...base, next: "none" as const, detail: t.authority ? `authority is ${t.authority}, not this wallet` : "frozen (no authority): cannot be closed" };
    if (t.active) {
      return {
        ...base,
        next: "deactivate" as const,
        detail: "1) DeactivateLookupTable (authority signs, ~5000 lamports fee). 2) After ~512 slots (~3.5 min), CloseLookupTable to this wallet."
      };
    }
    const deactivated = Number(t.deactivationSlot);
    const closableAt = deactivated + SLOT_HASHES_WINDOW + 1;
    return currentSlot >= closableAt
      ? { ...base, next: "close" as const, detail: "CloseLookupTable (authority signs, recipient = this wallet)." }
      : { ...base, next: "wait" as const, detail: `deactivated at slot ${deactivated}; closable from about slot ${closableAt} (${closableAt - currentSlot} slots).` };
  });
}
