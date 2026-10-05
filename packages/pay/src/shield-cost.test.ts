import { describe, expect, it, vi } from "vitest";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getAddressEncoder,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessagePriorityFeeLamports,
  AccountRole,
  type Blockhash
} from "@solana/kit";
import { captureTransport, DRY_RUN_ERROR_CODE, GET_MULTIPLE_ACCOUNTS_MAX, readAccountsBatched, type SimulationOutcome } from "./rpc-capture";
import { shieldCost, SYSTEM_PROGRAM, systemMovements } from "./shield-cost";
import { CLOAK_PROGRAM_ID } from "./shield-diagnosis";

/**
 * SOL cost of a simulated v1 shield. FIXTURE numbers (balances, rent, fee) are
 * illustrative, not the mainnet run: they exercise the arithmetic and the
 * read-only measurement path.
 */

const PAYER = address("9qAezschd4e5t5yi9F5SAw41g43Vuj6iYMh7dpcKqkUi");
const POOL = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const NEW_A = address("2VH5VUHmCpGXFj66qVLTpBWqFhDxJNWA53oG65i2mn56");
const NEW_B = address("GLVcKLgw5rRsa6eWNXwNqMzP4tX8zXgfEMCx9837aan3");
const BLOCKHASH = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM" as Blockhash;

function v1Deposit(): string {
  const msg = pipe(
    createTransactionMessage({ version: 1 }),
    (m) => setTransactionMessageFeePayer(PAYER, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: 1n }, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          {
            programAddress: address(CLOAK_PROGRAM_ID),
            accounts: [
              { address: POOL, role: AccountRole.WRITABLE },
              { address: NEW_A, role: AccountRole.WRITABLE },
              { address: NEW_B, role: AccountRole.WRITABLE },
              { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY }
            ],
            data: new Uint8Array(64)
          }
        ],
        m
      ),
    (m) => setTransactionMessageComputeUnitLimit(1_200_000, m),
    (m) => setTransactionMessagePriorityFeeLamports(120_000n, m)
  );
  return getBase64EncodedWireTransaction(compileTransaction(msg as Parameters<typeof compileTransaction>[0]));
}

function createAccountData(lamports: bigint, space: bigint, owner: string): string {
  const d = new Uint8Array(52);
  const v = new DataView(d.buffer);
  v.setUint32(0, 0, true);
  v.setBigUint64(4, lamports, true);
  v.setBigUint64(12, space, true);
  d.set(getAddressEncoder().encode(address(owner)), 20);
  return getBase58Decoder().decode(d);
}

function transferData(lamports: bigint): string {
  const d = new Uint8Array(12);
  const v = new DataView(d.buffer);
  v.setUint32(0, 2, true);
  v.setBigUint64(4, lamports, true);
  return getBase58Decoder().decode(d);
}

describe("systemMovements", () => {
  it("decodes createAccount and transfer, marking accounts that did not exist", () => {
    const keys = [PAYER, NEW_A, NEW_B, SYSTEM_PROGRAM];
    const before = new Map<string, bigint | null>([[PAYER, 1n], [NEW_A, null], [NEW_B, 5n]]);
    const m = systemMovements(
      [
        { programIdIndex: 3, accounts: [0, 1], data: createAccountData(1_461_600n, 82n, CLOAK_PROGRAM_ID) },
        { programIdIndex: 3, accounts: [0, 2], data: transferData(7n) },
        { programIdIndex: 1, accounts: [0, 2], data: transferData(9n) } // not the System Program
      ],
      keys,
      before
    );
    expect(m).toEqual([
      { kind: "createAccount", from: PAYER, to: NEW_A, lamports: 1_461_600n, space: 82n, owner: CLOAK_PROGRAM_ID, toExistedBefore: false },
      { kind: "transfer", from: PAYER, to: NEW_B, lamports: 7n, toExistedBefore: true }
    ]);
  });
});

describe("shieldCost", () => {
  const base = { feePayer: PAYER, priorityFee: 120_000n, networkFee: 130_000n, payerRentExemptMinimum: 890_880n };
  const movements = [
    { kind: "createAccount" as const, from: PAYER, to: NEW_A, lamports: 1_000_000n, space: 16n, owner: CLOAK_PROGRAM_ID, toExistedBefore: false },
    { kind: "createAccount" as const, from: PAYER, to: NEW_B, lamports: 2_000_000n, space: 200n, owner: CLOAK_PROGRAM_ID, toExistedBefore: false }
  ];

  it("splits fee, priority fee and rent; the simulated debit is fully explained", () => {
    const c = shieldCost({ ...base, movements, accounts: [{ address: PAYER, before: 8_265_410n, after: 8_265_410n - 130_000n - 3_000_000n }] });
    expect(c.baseFee).toBe(10_000n);
    expect(c.priorityFee).toBe(120_000n);
    expect(c.rentIntoNewAccounts).toBe(3_000_000n);
    expect(c.simulationIncludesFee).toBe(true);
    expect(c.otherDebits).toBe(0n);
    expect(c.estimatedTotal).toBe(3_130_000n);
    // total + rent-exempt floor + max(10%, 0.0005 SOL)
    expect(c.recommendedMinimum).toBe(3_130_000n + 890_880n + 500_000n);
    expect(c.sufficient).toBe(true);
  });

  it("surfaces an unexplained debit and says when the balance is short", () => {
    const c = shieldCost({ ...base, movements, accounts: [{ address: PAYER, before: 3_500_000n, after: 3_500_000n - 3_000_000n - 40_000n }] });
    expect(c.simulationIncludesFee).toBe(null);
    expect(c.otherDebits).toBe(40_000n);
    expect(c.estimatedTotal).toBe(130_000n + 3_000_000n + 40_000n);
    expect(c.sufficient).toBe(false);
  });
});

describe("captureTransport measureCost (simulate-only)", () => {
  it("asks for post-state + inner instructions, reads balances/fee/rent, and still never sends", async () => {
    const wire = v1Deposit();
    const methods: string[] = [];
    let simulateParams: unknown;
    const fake = vi.fn(async ({ payload }: { payload: unknown }) => {
      const p = payload as { id: unknown; method: string; params: unknown[] };
      methods.push(p.method);
      const ok = (result: unknown) => ({ jsonrpc: "2.0", id: p.id, result });
      switch (p.method) {
        case "simulateTransaction": {
          simulateParams = p.params[1];
          const keys = (p.params[1] as { accounts: { addresses: string[] } }).accounts.addresses;
          const post: Record<string, number> = { [PAYER]: 8_265_410 - 130_000 - 3_000_000, [POOL]: 5_000_000, [NEW_A]: 1_000_000, [NEW_B]: 2_000_000 };
          return ok({
            context: { slot: 1 },
            value: {
              err: null,
              logs: [`Program ${CLOAK_PROGRAM_ID} invoke [1]`, `Program ${CLOAK_PROGRAM_ID} success`],
              unitsConsumed: 209_317,
              accounts: keys.map((k) => ({ lamports: post[k], owner: SYSTEM_PROGRAM, data: ["", "base64"] })),
              innerInstructions: [
                {
                  index: 0,
                  instructions: [
                    { programId: SYSTEM_PROGRAM, parsed: { type: "createAccount", info: { source: PAYER, newAccount: NEW_A, lamports: 1_000_000, space: 16, owner: CLOAK_PROGRAM_ID } } },
                    { programId: SYSTEM_PROGRAM, parsed: { type: "createAccount", info: { source: PAYER, newAccount: NEW_B, lamports: 2_000_000, space: 200, owner: CLOAK_PROGRAM_ID } } }
                  ]
                }
              ]
            }
          });
        }
        case "getMultipleAccounts": {
          const pre: Record<string, number | null> = { [PAYER]: 8_265_410, [POOL]: 5_000_000, [NEW_A]: null, [NEW_B]: null };
          return ok({ context: { slot: 1 }, value: (p.params[0] as string[]).map((k) => (pre[k] === null ? null : { lamports: pre[k] })) });
        }
        case "getFeeForMessage":
          return ok({ context: { slot: 1 }, value: 130_000 });
        case "getMinimumBalanceForRentExemption":
          return ok(890_880);
        default:
          throw new Error(`unexpected ${p.method}`);
      }
    });
    const outcomes: SimulationOutcome[] = [];
    const t = captureTransport(fake, "simulate-only", { onSimulation: (o) => outcomes.push(o), measureCost: true });
    const response = (await t({ payload: { jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [wire, { encoding: "base64" }] } })) as { error: { code: number } };

    expect(response.error.code).toBe(DRY_RUN_ERROR_CODE);
    expect(methods).not.toContain("sendTransaction");
    expect(methods[0]).toBe("simulateTransaction");
    expect(simulateParams).toMatchObject({ sigVerify: false, innerInstructions: true, accounts: { encoding: "base64" } });
    const cost = outcomes[0]!.cost!;
    expect(outcomes[0]!.costError).toBeUndefined();
    expect(cost.networkFee).toBe(130_000n);
    expect(cost.priorityFee).toBe(120_000n);
    expect(cost.baseFee).toBe(10_000n);
    expect(cost.rentIntoNewAccounts).toBe(3_000_000n);
    expect(cost.movements.map((m) => m.to)).toEqual([NEW_A, NEW_B]);
    expect(cost.accounts.find((a) => a.address === NEW_A)).toEqual({ address: NEW_A, before: null, after: 1_000_000n });
    expect(cost.simulationIncludesFee).toBe(true);
    expect(cost.estimatedTotal).toBe(3_130_000n);
    expect(cost.sufficient).toBe(true);
    // the post-state account dump is not copied into the diagnostic
    expect(outcomes[0]!.diagnostic.data.accounts).toBeNull();
  });
});

describe("readAccountsBatched (RPC Fast: getMultipleAccounts max 5 inputs)", () => {
  function fakeRpc() {
    const calls: string[][] = [];
    const base = vi.fn(async ({ payload }: { payload: unknown }) => {
      const p = payload as { id: unknown; method: string; params: [string[], unknown] };
      expect(p.method).toBe("getMultipleAccounts");
      const keys = p.params[0];
      calls.push(keys);
      if (keys.length > GET_MULTIPLE_ACCOUNTS_MAX) return { jsonrpc: "2.0", id: p.id, error: { code: -32602, message: "Too many inputs provided; max 5" } };
      return { jsonrpc: "2.0", id: p.id, result: { context: { slot: 1 }, value: keys.map((k) => (k.startsWith("missing") ? null : { lamports: Number(k.split("-")[1]) })) } };
    });
    return { base, calls };
  }

  it("splits 9 writable accounts into 5 + 4 and keeps the original order", async () => {
    const { base, calls } = fakeRpc();
    const keys = Array.from({ length: 9 }, (_, i) => (i === 6 ? "missing-6" : `acct-${i + 1}`));
    const values = await readAccountsBatched(base, undefined, keys, "confirmed");
    expect(calls.map((c) => c.length)).toEqual([5, 4]);
    expect(calls.flat()).toEqual(keys);
    expect(values).toEqual([1, 2, 3, 4, 5, 6, null, 8, 9].map((v) => (v === null ? null : { lamports: v })));
  });

  it("handles a non-multiple of 5 with duplicates, and exactly 5 in one call", async () => {
    const seven = fakeRpc();
    const keys = ["acct-1", "acct-2", "acct-1", "acct-3", "acct-4", "acct-5", "acct-2"];
    const values = await readAccountsBatched(seven.base, undefined, keys, "confirmed");
    expect(seven.calls.map((c) => c.length)).toEqual([5, 2]);
    expect(values.map((v) => (v as { lamports: number }).lamports)).toEqual([1, 2, 1, 3, 4, 5, 2]);

    const five = fakeRpc();
    await readAccountsBatched(five.base, undefined, ["acct-1", "acct-2", "acct-3", "acct-4", "acct-5"], "confirmed");
    expect(five.calls).toHaveLength(1);
    expect(await readAccountsBatched(fakeRpc().base, undefined, [], "confirmed")).toEqual([]);
  });

  it("fails the measurement (no retry) when a batch errors or comes back short", async () => {
    const base = vi.fn(async ({ payload }: { payload: unknown }) => ({ jsonrpc: "2.0", id: (payload as { id: unknown }).id, result: { value: [null] } }));
    await expect(readAccountsBatched(base, undefined, ["a", "b"], "confirmed")).rejects.toThrow(/1 entries for 2/);
    expect(base).toHaveBeenCalledOnce();
  });
});
