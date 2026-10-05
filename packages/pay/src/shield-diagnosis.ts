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
  lookupTableTransaction: SignatureSummary | null;
  lookupTable: LookupTableState | null;
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
  const result = await rpc<{ value: { owner: string; data: { parsed?: { info?: Record<string, unknown> } } } | null }>("getAccountInfo", [
    tableAddress,
    { encoding: "jsonParsed", commitment: "confirmed" }
  ]);
  const account = result.value;
  if (!account) {
    return { address: tableAddress, exists: false, owner: null, addresses: [], authority: null, deactivationSlot: null, lastExtendedSlot: null, lastExtendedSlotStartIndex: null, active: false, warmedUp: null };
  }
  const info = account.data.parsed?.info ?? {};
  const lastExtendedSlot = info.lastExtendedSlot !== undefined ? Number(info.lastExtendedSlot) : null;
  const deactivationSlot = info.deactivationSlot !== undefined ? String(info.deactivationSlot) : null;
  return {
    address: tableAddress,
    exists: true,
    owner: account.owner,
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
  const lookupTable = lookupTableTransaction?.lookupTable ? await readLookupTable(rpc, lookupTableTransaction.lookupTable.address, slot) : null;
  return {
    wallet,
    currentSlot: slot,
    publicUsdc,
    solLamports: BigInt(sol.value),
    signatures,
    lookupTableTransaction,
    lookupTable,
    cloakTransactions: signatures.filter((s) => s.kind === "cloak").map((s) => s.signature)
  };
}
