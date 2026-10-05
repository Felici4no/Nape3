import { base58Encode } from "@nape3/chain";

/**
 * Minimal, read-only decoder of a serialized Solana transaction (legacy or v0)
 * for diagnostics: which programs a transaction invokes, which lookup tables
 * it references, and the addresses an ALT extension would add. Program ids of
 * top-level instructions are always static keys, so they are exact.
 * It never re-serializes, signs or stores the transaction.
 */

export const ALT_PROGRAM = "AddressLookupTab1e1111111111111111111111111";

export interface DecodedTransaction {
  version: "legacy" | 0 | number;
  signatures: number;
  staticKeys: string[];
  /** Top-level instructions, in order. */
  instructions: Array<{ index: number; programId: string; dataLength: number }>;
  programIds: string[];
  lookupTables: Array<{ table: string; writable: number; readonly: number }>;
  /** Addresses appended by ExtendLookupTable instructions in this transaction. */
  extendedAddresses: string[];
  /** CreateLookupTable / ExtendLookupTable / Freeze / Deactivate / Close present. */
  altInstructions: string[];
}

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}
  u8(): number {
    if (this.offset >= this.bytes.length) throw new RangeError("transaction truncated");
    return this.bytes[this.offset++]!;
  }
  shortvec(): number {
    let value = 0;
    for (let shift = 0; shift < 21; shift += 7) {
      const b = this.u8();
      value |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) return value;
    }
    throw new RangeError("bad shortvec");
  }
  take(n: number): Uint8Array {
    if (this.offset + n > this.bytes.length) throw new RangeError("transaction truncated");
    const out = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
}

const ALT_INSTRUCTION_NAMES = ["CreateLookupTable", "FreezeLookupTable", "ExtendLookupTable", "DeactivateLookupTable", "CloseLookupTable"];

function u32le(b: Uint8Array): number {
  return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
}

export function decodeTransaction(wire: Uint8Array): DecodedTransaction {
  const r = new Reader(wire);
  const signatures = r.shortvec();
  r.take(64 * signatures);
  const first = r.u8();
  let version: DecodedTransaction["version"] = "legacy";
  let headerFirst = first;
  if (first & 0x80) {
    version = first & 0x7f;
    headerFirst = r.u8();
  }
  void headerFirst;
  r.take(2); // rest of the header
  const keyCount = r.shortvec();
  const staticKeys = Array.from({ length: keyCount }, () => base58Encode(r.take(32)));
  r.take(32); // recent blockhash
  const ixCount = r.shortvec();
  const instructions: DecodedTransaction["instructions"] = [];
  const extendedAddresses: string[] = [];
  const altInstructions: string[] = [];
  for (let i = 0; i < ixCount; i++) {
    const programIndex = r.u8();
    r.take(r.shortvec()); // account indexes
    const data = r.take(r.shortvec());
    const programId = staticKeys[programIndex] ?? `#${programIndex}`;
    instructions.push({ index: i, programId, dataLength: data.length });
    if (programId === ALT_PROGRAM && data.length >= 4) {
      const tag = u32le(data);
      altInstructions.push(ALT_INSTRUCTION_NAMES[tag] ?? `AltInstruction${tag}`);
      if (tag === 2 && data.length >= 12) {
        // ExtendLookupTable: u32 tag, u64 count, then 32-byte addresses
        const count = u32le(data.subarray(4, 8));
        for (let k = 0; k < count && 12 + (k + 1) * 32 <= data.length; k++) extendedAddresses.push(base58Encode(data.subarray(12 + k * 32, 12 + (k + 1) * 32)));
      }
    }
  }
  const lookupTables: DecodedTransaction["lookupTables"] = [];
  if (version !== "legacy") {
    const lookups = r.shortvec();
    for (let i = 0; i < lookups; i++) {
      const table = base58Encode(r.take(32));
      const writable = r.take(r.shortvec()).length;
      const readonly = r.take(r.shortvec()).length;
      lookupTables.push({ table, writable, readonly });
    }
  }
  return {
    version,
    signatures,
    staticKeys,
    instructions,
    programIds: [...new Set(instructions.map((i) => i.programId))],
    lookupTables,
    extendedAddresses,
    altInstructions
  };
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Uint8Array(Buffer.from(b64, "base64"));
}
