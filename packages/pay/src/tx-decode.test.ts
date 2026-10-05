import { describe, expect, it } from "vitest";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getAddressEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  AccountRole,
  type Address,
  type Blockhash
} from "@solana/kit";
import { shieldVerdict } from "./runtime";
import type { SimulationOutcome } from "./rpc-capture";
import { CLOAK_PROGRAM_ID } from "./shield-diagnosis";
import { ALT_PROGRAM, base64ToBytes, decodeTransaction } from "./tx-decode";
import { diagnosticFromRpcError } from "@nape3/payments/cloak";

const PAYER = address("9qAezschd4e5t5yi9F5SAw41g43Vuj6iYMh7dpcKqkUi");
const TABLE = address("GLVcKLgw5rRsa6eWNXwNqMzP4tX8zXgfEMCx9837aan3");
const POOL = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const EXTRA = address("2VH5VUHmCpGXFj66qVLTpBWqFhDxJNWA53oG65i2mn56");
const CU = address("ComputeBudget111111111111111111111111111111");
const BLOCKHASH = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM" as Blockhash;

function wire(message: unknown): Uint8Array {
  return base64ToBytes(getBase64EncodedWireTransaction(compileTransaction(message as Parameters<typeof compileTransaction>[0])));
}

const lifetime = { blockhash: BLOCKHASH, lastValidBlockHeight: 1n };
const legacyBase = () => pipe(createTransactionMessage({ version: "legacy" }), (m) => setTransactionMessageFeePayer(PAYER, m), (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m));
const v0Base = () => pipe(createTransactionMessage({ version: 0 }), (m) => setTransactionMessageFeePayer(PAYER, m), (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m));

describe("decodeTransaction", () => {
  it("reads an ALT create + extend (legacy) and the addresses it would add", () => {
    const enc = getAddressEncoder();
    const extendData = new Uint8Array([2, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, ...enc.encode(POOL), ...enc.encode(EXTRA)]);
    const msg = appendTransactionMessageInstructions(
      [
        { programAddress: address(ALT_PROGRAM), accounts: [{ address: TABLE, role: AccountRole.WRITABLE }], data: new Uint8Array([0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 255]) },
        { programAddress: address(ALT_PROGRAM), accounts: [{ address: TABLE, role: AccountRole.WRITABLE }], data: extendData }
      ],
      legacyBase()
    );
    const d = decodeTransaction(wire(msg));
    expect(d.version).toBe("legacy");
    expect(d.programIds).toEqual([ALT_PROGRAM]);
    expect(d.altInstructions).toEqual(["CreateLookupTable", "ExtendLookupTable"]);
    expect(d.extendedAddresses).toEqual([POOL, EXTRA]);
    expect(d.lookupTables).toEqual([]);
  });

  it("reads a v0 deposit-shaped transaction: program ids and the lookup tables it references", () => {
    const msg = compressTransactionMessageUsingAddressLookupTables(
      appendTransactionMessageInstructions(
        [
          { programAddress: CU, accounts: [], data: new Uint8Array([2, 0, 0, 0, 0]) },
          { programAddress: address(CLOAK_PROGRAM_ID), accounts: [{ address: POOL, role: AccountRole.WRITABLE }, { address: EXTRA, role: AccountRole.READONLY }], data: new Uint8Array(40) }
        ],
        v0Base()
      ),
      { [TABLE]: [POOL, EXTRA] as Address[] }
    );
    const d = decodeTransaction(wire(msg));
    expect(d.version).toBe(0);
    expect(d.instructions.map((i) => i.programId)).toEqual([CU, CLOAK_PROGRAM_ID]);
    expect(d.lookupTables).toEqual([{ table: TABLE, writable: 1, readonly: 1 }]);
    expect(d.altInstructions).toEqual([]);
  });

  it("rejects truncated bytes instead of guessing", () => {
    expect(() => decodeTransaction(new Uint8Array([1, 2, 3]))).toThrow(/truncated/);
  });
});

describe("shieldVerdict: never 'would succeed' without the Cloak program", () => {
  const ok = diagnosticFromRpcError({ code: 0, message: "Simulation succeeded", data: { err: null, logs: [] } });
  const failed = diagnosticFromRpcError({ code: -32002, message: "failed", data: { err: { InstructionError: [3, { Custom: 4272 }] }, logs: [] } });
  const tx = (programIds: string[], altInstructions: string[] = []) => ({ version: 0, signatures: 1, staticKeys: [], instructions: [], programIds, lookupTables: [], extendedAddresses: [], altInstructions });
  const altSetup: SimulationOutcome = { ok: true, diagnostic: ok, transaction: tx([ALT_PROGRAM], ["CreateLookupTable", "ExtendLookupTable"]) };

  it("a successful ALT setup simulation is NOT_A_SHIELD_SIMULATION", () => {
    const v = shieldVerdict([altSetup]);
    expect(v.verdict).toBe("NOT_A_SHIELD_SIMULATION");
    expect(v.verdictReason).toMatch(/CreateLookupTable \+ ExtendLookupTable/);
    expect(v.outcome).toBeNull();
  });

  it("judges the Cloak deposit only", () => {
    expect(shieldVerdict([{ ok: false, diagnostic: failed, transaction: tx([CU, CLOAK_PROGRAM_ID]) }])).toMatchObject({ verdict: "WOULD_FAIL" });
    expect(shieldVerdict([altSetup, { ok: true, diagnostic: ok, transaction: tx([CLOAK_PROGRAM_ID]) }])).toMatchObject({ verdict: "WOULD_SUCCEED" });
    expect(shieldVerdict([{ ok: true, diagnostic: ok, transaction: null }]).verdict).toBe("NOT_A_SHIELD_SIMULATION");
    expect(shieldVerdict([]).verdict).toBe("NOT_A_SHIELD_SIMULATION");
  });
});
