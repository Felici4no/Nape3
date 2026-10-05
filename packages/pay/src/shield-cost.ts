import { getBase58Codec } from "@solana/kit";

/**
 * SOL requirement of one simulated shield, split into network fee, priority
 * fee, rent moved into newly created accounts and anything else. Pure: every
 * input comes from RPC reads around a simulateTransaction (nothing is sent).
 */

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export interface AccountSnapshot {
  address: string;
  /** null = the account does not exist. */
  lamports: bigint | null;
}

export interface InnerInstruction {
  programIdIndex: number;
  accounts: number[];
  /** base58, as returned by simulateTransaction. */
  data: string;
}

export interface SystemMovement {
  kind: "createAccount" | "transfer";
  from: string;
  to: string;
  lamports: bigint;
  /** createAccount only. */
  space?: bigint;
  owner?: string;
  /** Whether `to` existed before the transaction. */
  toExistedBefore: boolean;
}

export interface ShieldCost {
  feePayer: string;
  walletBalance: bigint;
  /** Signature fees of the compiled message (from getFeeForMessage, minus the priority fee when it includes it). */
  baseFee: bigint | null;
  /** From the v1 message config (`priorityFeeLamports`). */
  priorityFee: bigint;
  /** getFeeForMessage for the exact compiled message (the cluster's own fee for it). */
  networkFee: bigint | null;
  /** Lamports the System Program moved from the fee payer during execution (inner instructions). */
  movements: SystemMovement[];
  rentIntoNewAccounts: bigint;
  /** Fee-payer debit the simulation shows beyond fee + System movements (0 when fully explained). */
  otherDebits: bigint;
  /** Whether the simulated post balance already had the fee deducted. */
  simulationIncludesFee: boolean | null;
  estimatedTotal: bigint;
  /** Rent-exempt minimum of a 0-byte system account: the wallet must stay at or above it. */
  payerRentExemptMinimum: bigint;
  recommendedMinimum: bigint;
  sufficient: boolean;
  /** Writable accounts: balance before (on chain now) and after (simulated). */
  accounts: Array<{ address: string; before: bigint | null; after: bigint | null }>;
}

function u64le(b: Uint8Array, at: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[at + i]!);
  return v;
}

function u32le(b: Uint8Array, at: number): number {
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
}

/** System Program createAccount (0) and transfer (2) from simulation inner instructions. */
export function systemMovements(inner: readonly InnerInstruction[], accountKeys: readonly string[], before: ReadonlyMap<string, bigint | null>): SystemMovement[] {
  const base58 = getBase58Codec();
  const out: SystemMovement[] = [];
  for (const ix of inner) {
    if (accountKeys[ix.programIdIndex] !== SYSTEM_PROGRAM) continue;
    let data: Uint8Array;
    try {
      data = new Uint8Array(base58.encode(ix.data));
    } catch {
      continue;
    }
    if (data.length < 12) continue;
    const tag = u32le(data, 0);
    const from = accountKeys[ix.accounts[0]!] ?? "?";
    const to = accountKeys[ix.accounts[1]!] ?? "?";
    const existed = (before.get(to) ?? null) !== null;
    if (tag === 0 && data.length >= 52) {
      out.push({ kind: "createAccount", from, to, lamports: u64le(data, 4), space: u64le(data, 12), owner: base58ToString(data.subarray(20, 52)), toExistedBefore: existed });
    } else if (tag === 2) {
      out.push({ kind: "transfer", from, to, lamports: u64le(data, 4), toExistedBefore: existed });
    }
  }
  return out;
}

function base58ToString(bytes: Uint8Array): string {
  return getBase58Codec().decode(bytes);
}


export interface CostInputs {
  feePayer: string;
  accounts: Array<{ address: string; before: bigint | null; after: bigint | null }>;
  movements: SystemMovement[];
  networkFee: bigint | null;
  priorityFee: bigint;
  payerRentExemptMinimum: bigint;
  /** Extra margin on top of the requirement (default: 10% of the total, at least 0.0005 SOL). */
  marginLamports?: bigint;
}

export function shieldCost(input: CostInputs): ShieldCost {
  const payer = input.accounts.find((a) => a.address === input.feePayer);
  const walletBalance = payer?.before ?? 0n;
  const payerAfter = payer?.after ?? null;
  const fromPayer = input.movements.filter((m) => m.from === input.feePayer);
  const outflows = fromPayer.reduce((s, m) => s + m.lamports, 0n);
  const rentIntoNewAccounts = fromPayer.filter((m) => !m.toExistedBefore).reduce((s, m) => s + m.lamports, 0n);
  const simulatedDebit = payerAfter === null ? null : walletBalance - payerAfter;

  let simulationIncludesFee: boolean | null = null;
  let otherDebits = 0n;
  if (simulatedDebit !== null) {
    if (input.networkFee !== null && simulatedDebit === outflows + input.networkFee) simulationIncludesFee = true;
    else if (simulatedDebit === outflows) simulationIncludesFee = false;
    const explained = outflows + (simulationIncludesFee ? (input.networkFee ?? 0n) : 0n);
    otherDebits = simulatedDebit > explained ? simulatedDebit - explained : 0n;
  }
  const fee = input.networkFee ?? input.priorityFee + 10_000n; // fallback: 2 signatures (tx + Ed25519) + priority
  const estimatedTotal = fee + outflows + otherDebits;
  const margin = input.marginLamports ?? (estimatedTotal / 10n > 500_000n ? estimatedTotal / 10n : 500_000n);
  const recommendedMinimum = estimatedTotal + input.payerRentExemptMinimum + margin;
  const baseFee = input.networkFee === null ? null : input.networkFee >= input.priorityFee ? input.networkFee - input.priorityFee : input.networkFee;
  return {
    feePayer: input.feePayer,
    walletBalance,
    baseFee,
    priorityFee: input.priorityFee,
    networkFee: input.networkFee,
    movements: input.movements,
    rentIntoNewAccounts,
    otherDebits,
    simulationIncludesFee,
    estimatedTotal,
    payerRentExemptMinimum: input.payerRentExemptMinimum,
    recommendedMinimum,
    sufficient: walletBalance >= recommendedMinimum,
    accounts: input.accounts
  };
}
