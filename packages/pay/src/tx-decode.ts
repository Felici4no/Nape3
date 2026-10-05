import { getAddressDecoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";

/**
 * Read-only decoder of a serialized Solana transaction (legacy, v0, v1) for
 * diagnostics, built on @solana/kit's own codecs: which programs it invokes,
 * which lookup tables it references, the addresses an ALT extension would
 * add, its size and (v1) compute config. Program ids of top-level
 * instructions are always static keys, so they are exact. It never
 * re-serializes, signs or stores the transaction.
 */

export const ALT_PROGRAM = "AddressLookupTab1e1111111111111111111111111";

export interface DecodedTransaction {
  version: "legacy" | number;
  /** Serialized size in bytes (what the packet limit applies to). */
  size: number;
  signatures: number;
  staticKeys: string[];
  /** Top-level instructions, in order. */
  instructions: Array<{ index: number; programId: string; dataLength: number; accounts: number }>;
  programIds: string[];
  lookupTables: Array<{ table: string; writable: number; readonly: number }>;
  /** Addresses appended by ExtendLookupTable instructions in this transaction. */
  extendedAddresses: string[];
  /** CreateLookupTable / ExtendLookupTable / Freeze / Deactivate / Close present. */
  altInstructions: string[];
  /** v1 message-header compute config (SIMD-0385), when present. */
  config: Record<string, number | string> | null;
}

const ALT_INSTRUCTION_NAMES = ["CreateLookupTable", "FreezeLookupTable", "ExtendLookupTable", "DeactivateLookupTable", "CloseLookupTable"];

function u32le(b: Uint8Array, at = 0): number {
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
}

interface RawInstruction {
  programAddressIndex: number;
  accountIndices: readonly number[];
  data: Uint8Array;
}

/** Normalizes legacy/v0 `instructions` and v1 `instructionHeaders` + `instructionPayloads`. */
function instructionsOf(message: Record<string, unknown>): RawInstruction[] {
  if (Array.isArray(message.instructions)) {
    return (message.instructions as Array<{ programAddressIndex: number; accountIndices?: number[]; data?: Uint8Array }>).map((ix) => ({
      programAddressIndex: ix.programAddressIndex,
      accountIndices: ix.accountIndices ?? [],
      data: ix.data ?? new Uint8Array()
    }));
  }
  const headers = (message.instructionHeaders ?? []) as Array<{ programAccountIndex: number }>;
  const payloads = (message.instructionPayloads ?? []) as Array<{ instructionAccountIndices: number[]; instructionData: Uint8Array }>;
  return headers.map((h, i) => ({
    programAddressIndex: h.programAccountIndex,
    accountIndices: payloads[i]?.instructionAccountIndices ?? [],
    data: payloads[i]?.instructionData ?? new Uint8Array()
  }));
}

export function decodeTransaction(wire: Uint8Array): DecodedTransaction {
  if (wire.length < 66) throw new RangeError("transaction truncated");
  const transaction = getTransactionDecoder().decode(wire);
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes) as unknown as Record<string, unknown> & {
    version: "legacy" | number;
    staticAccounts: string[];
    addressTableLookups?: Array<{ lookupTableAddress: string; writableIndexes?: number[]; readonlyIndexes?: number[]; writableIndices?: number[]; readonlyIndices?: number[] }>;
    configValues?: Array<{ kind: string; value: number | bigint }>;
  };
  const staticKeys = message.staticAccounts.map(String);
  const addressDecoder = getAddressDecoder();
  const instructions: DecodedTransaction["instructions"] = [];
  const extendedAddresses: string[] = [];
  const altInstructions: string[] = [];
  instructionsOf(message).forEach((ix, index) => {
    const programId = staticKeys[ix.programAddressIndex] ?? `#${ix.programAddressIndex}`;
    instructions.push({ index, programId, dataLength: ix.data.length, accounts: ix.accountIndices.length });
    if (programId === ALT_PROGRAM && ix.data.length >= 4) {
      const tag = u32le(ix.data);
      altInstructions.push(ALT_INSTRUCTION_NAMES[tag] ?? `AltInstruction${tag}`);
      if (tag === 2 && ix.data.length >= 12) {
        // ExtendLookupTable: u32 tag, u64 count, 32-byte addresses
        const count = u32le(ix.data, 4);
        for (let k = 0; k < count && 12 + (k + 1) * 32 <= ix.data.length; k++) {
          extendedAddresses.push(addressDecoder.decode(ix.data.subarray(12 + k * 32, 12 + (k + 1) * 32)));
        }
      }
    }
  });
  const lookupTables = (message.addressTableLookups ?? []).map((l) => ({
    table: String(l.lookupTableAddress),
    writable: (l.writableIndexes ?? l.writableIndices ?? []).length,
    readonly: (l.readonlyIndexes ?? l.readonlyIndices ?? []).length
  }));
  const config = message.configValues?.length
    ? Object.fromEntries(message.configValues.map((c, i) => [`${c.kind}#${i}`, typeof c.value === "bigint" ? c.value.toString() : c.value]))
    : null;
  return {
    version: message.version,
    size: wire.length,
    signatures: Object.keys(transaction.signatures).length,
    staticKeys,
    instructions,
    programIds: [...new Set(instructions.map((i) => i.programId))],
    lookupTables,
    extendedAddresses,
    altInstructions,
    config
  };
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Uint8Array(Buffer.from(b64, "base64"));
}
