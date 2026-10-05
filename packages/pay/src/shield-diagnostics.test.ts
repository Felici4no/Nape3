import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyRelayError } from "@cloak.dev/sdk";
import { decodeSolanaErrorContext, diagnosticFromError, diagnosticFromMessage, diagnosticFromRpcError, formatDiagnostic, safeErrorMessage } from "@nape3/payments/cloak";
import { getSolanaErrorFromJsonRpcError } from "@solana/kit";
import { captureTransport, DRY_RUN_ERROR_CODE, dryRunSigner } from "./rpc-capture";
import { ALT_PROGRAM_ID, CLOAK_PROGRAM_ID, diagnoseShieldChain, U64_MAX, type RpcCall } from "./shield-diagnosis";
import { MemoryIntentStore } from "./shield-intent";
import { ShieldOperation, type ShieldDeps, type ShieldFunding } from "./shield-op";

/**
 * Regression for the first mainnet shield failure ("RelayInternalError: Relay
 * returned an error: Solana error #-32002"): the RPC's preflight explanation
 * must survive the SDK's re-wrapping and our redaction.
 *
 * FIXTURE: the preflight payload below is a representative -32002 response
 * shape (InstructionError + program logs), not the real failure's logs, which
 * were not captured. It exercises the decoding path end to end.
 */

const CU = "ComputeBudget111111111111111111111111111111";
const WALLET = "9qAezschd4e5t5yi9F5SAw41g43Vuj6iYMh7dpcKqkUi";
const PREFLIGHT = {
  code: -32002,
  message: "Transaction simulation failed: Error processing Instruction 2: custom program error: 0x10b0",
  data: {
    accounts: null,
    err: { InstructionError: [2, { Custom: 4272 }] },
    innerInstructions: null,
    logs: [
      `Program ${CU} invoke [1]`,
      `Program ${CU} success`,
      `Program ${CLOAK_PROGRAM_ID} invoke [1]`,
      "Program log: Instruction: Transact, amount 1000000, mint EPjF…, see https://rpc.example/?api_key=SECRET",
      "Program log: Error: RangeQuoteExpired",
      `Program ${CLOAK_PROGRAM_ID} consumed 41234 of 1199700 compute units`,
      `Program ${CLOAK_PROGRAM_ID} failed: custom program error: 0x10b0`
    ],
    replacementBlockhash: null,
    returnData: null,
    unitsConsumed: 41234
  }
};

const env = process.env as Record<string, string | undefined>;
const ORIGINAL_ENV = env.NODE_ENV;
afterEach(() => {
  env.NODE_ENV = ORIGINAL_ENV;
});

/** The error kit throws in a production build (what the deployed site sees). */
function productionPreflightError(): Error {
  env.NODE_ENV = "production";
  try {
    return getSolanaErrorFromJsonRpcError(PREFLIGHT) as Error;
  } finally {
    env.NODE_ENV = ORIGINAL_ENV;
  }
}

describe("the -32002 failure chain", () => {
  it("is misattributed to the relay and loses its logs in the SDK and in our redaction", () => {
    const solana = productionPreflightError();
    expect(solana.message).toMatch(/^Solana error #-32002; Decode this error by running `npx @solana\/errors decode -- -32002 '[A-Za-z0-9+/=]+'`$/);
    // What transact() does with any direct-submission error:
    const wrapped = classifyRelayError(solana.message);
    expect(wrapped.name).toBe("RelayInternalError");
    expect(wrapped.message).toMatch(/^Relay returned an error: Solana error #-32002/);
    // The SDK's pattern matching on 0x10b0 cannot see the code in a production message:
    expect(wrapped.name).not.toBe("SanctionsQuoteError");
    // And the generic redaction drops the only context there is:
    expect(safeErrorMessage(wrapped)).toContain("'[base64]'");
  });

  it("recovers logs, the failing program and the custom code from the wrapped error", () => {
    const wrapped = classifyRelayError(productionPreflightError().message);
    const d = diagnosticFromError(wrapped)!;
    expect(d.code).toBe(-32002);
    expect(d.source).toBe("message-context");
    expect(d.data.unitsConsumed).toBe(41234);
    expect(d.data.logs).toHaveLength(7);
    expect(d.failingInstruction).toMatchObject({ index: null, program: CLOAK_PROGRAM_ID, customCode: 4272, customCodeHex: "0x10b0", meaning: expect.stringContaining("RangeQuoteExpired") });
    const text = formatDiagnostic(d);
    expect(text).toContain("Program log: Error: RangeQuoteExpired");
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("https://");
  });

  it("gets the exact instruction index from the live SolanaError (cause) and from the raw RPC response", () => {
    const live = diagnosticFromError(productionPreflightError())!;
    expect(live.source).toBe("solana-error-context");
    expect(live.failingInstruction).toMatchObject({ index: 2, customCode: 4272 });
    const raw = diagnosticFromRpcError(PREFLIGHT);
    expect(raw.failingInstruction).toMatchObject({ index: 2, program: CLOAK_PROGRAM_ID, customCode: 4272 });
    expect(raw.data.err).toEqual({ InstructionError: [2, { Custom: 4272 }] });
  });

  it("decodes log lines that themselves contain ', '", () => {
    env.NODE_ENV = "production";
    const error = getSolanaErrorFromJsonRpcError({ ...PREFLIGHT, data: { ...PREFLIGHT.data, logs: ["Program log: a, b, c", `Program ${CU} success`] } }) as Error;
    env.NODE_ENV = ORIGINAL_ENV;
    const base64 = /'([A-Za-z0-9+/=]+)'/.exec(error.message)![1]!;
    expect(decodeSolanaErrorContext(base64).logs).toEqual(["Program log: a, b, c", `Program ${CU} success`]);
    expect(diagnosticFromMessage("no context here")).toBeNull();
  });

  it("reports transaction-level errors (e.g. a lookup-table index not yet usable)", () => {
    const d = diagnosticFromRpcError({ code: -32002, message: "Transaction simulation failed", data: { err: "InvalidAddressLookupTableIndex", logs: [] } });
    expect(d.transactionError).toBe("InvalidAddressLookupTableIndex");
    expect(formatDiagnostic(d)).toContain("Transaction error: InvalidAddressLookupTableIndex");
  });
});

describe("capture transport", () => {
  const WIRE = "AQAAAA-signed-transaction-bytes";

  it("live: records the structured preflight failure, never the request", async () => {
    const onFailure = vi.fn();
    const base = vi.fn(async () => ({ jsonrpc: "2.0", id: 1, error: PREFLIGHT }));
    const t = captureTransport(base, "live", { onFailure });
    const response = await t({ payload: { jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [WIRE, { encoding: "base64" }] } });
    expect(response).toEqual({ jsonrpc: "2.0", id: 1, error: PREFLIGHT }); // passed through unchanged
    expect(onFailure).toHaveBeenCalledOnce();
    const [diagnostic, method] = onFailure.mock.calls[0]!;
    expect(method).toBe("sendTransaction");
    expect(diagnostic.failingInstruction).toMatchObject({ index: 2, customCode: 4272 });
    expect(JSON.stringify(diagnostic)).not.toContain(WIRE);
    expect(base).toHaveBeenCalledOnce(); // no retry
  });

  it("simulate-only: never forwards sendTransaction; simulates the same bytes and refuses", async () => {
    const onSimulation = vi.fn();
    const base = vi.fn(async (_c: { payload: unknown }) => ({ jsonrpc: "2.0", id: 7, result: { context: { slot: 1 }, value: PREFLIGHT.data } }));
    const t = captureTransport(base, "simulate-only", { onSimulation });
    const response = (await t({ payload: { jsonrpc: "2.0", id: 7, method: "sendTransaction", params: [WIRE, { encoding: "base64", preflightCommitment: "confirmed" }] } })) as { error: { code: number } };
    expect(response.error.code).toBe(DRY_RUN_ERROR_CODE);
    expect(base).toHaveBeenCalledOnce();
    const forwarded = base.mock.calls[0]![0].payload as { method: string; params: [string, Record<string, unknown>] };
    expect(forwarded.method).toBe("simulateTransaction");
    expect(forwarded.params).toEqual([WIRE, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: false, commitment: "confirmed" }]);
    expect(onSimulation.mock.calls[0]![0]).toMatchObject({ ok: false, diagnostic: { failingInstruction: { index: 2, customCode: 4272 } } });

    // reads still pass through in simulate-only mode
    await t({ payload: { jsonrpc: "2.0", id: 8, method: "getLatestBlockhash", params: [] } });
    expect((base.mock.calls[1]![0].payload as { method: string }).method).toBe("getLatestBlockhash");
  });

  it("dry-run signer never asks the wallet and produces an unusable zero signature", async () => {
    const signer = dryRunSigner(WALLET as never);
    const [signatures] = await signer.signTransactions([{} as never]);
    expect(signatures).toEqual({ [WALLET]: new Uint8Array(64) });
  });
});

describe("ShieldOperation keeps the diagnostic and the block", () => {
  it("a preflight failure after 'Sending transaction' stays blocking and carries the decoded failure", async () => {
    let captured: ReturnType<typeof diagnosticFromRpcError> | null = null;
    const funding: ShieldFunding = {
      shieldedUsdc: async () => 0n,
      reconcile: async () => 0n,
      shield: async (_a, { onProgress }) => {
        onProgress("Waiting for wallet signature (lookup table)...");
        onProgress("Waiting for wallet signature...");
        onProgress("Sending transaction...");
        captured = diagnosticFromRpcError(PREFLIGHT); // what the capturing transport records
        throw classifyRelayError(productionPreflightError().message);
      }
    };
    const intents = new MemoryIntentStore();
    const deps: ShieldDeps = {
      connectWallet: async () => ({ name: "Phantom", address: WALLET }),
      readPublicBalances: async () => ({ publicUsdc: 6_062_919n, solLamports: 12_895_810n }),
      unlock: async () => funding,
      readTransaction: async () => null,
      intents,
      lastRpcFailure: () => captured,
      resetRpcFailure: () => (captured = null),
      provider: "rpc-fast",
      now: () => new Date("2026-10-05T12:00:00Z"),
      newId: () => "intent-1",
      sleep: async () => undefined
    };
    const op = new ShieldOperation(deps);
    await op.connect();
    await op.unlock();
    await op.prepare();
    await op.confirm();
    expect(op.state.failure).toMatchObject({ code: "outcome-unknown", blocking: true, diagnostic: { code: -32002, failingInstruction: { index: 2, customCode: 4272 } } });
    expect(op.state.failure!.message).toMatch(/rejected the shield in preflight simulation \(0x10b0\)/);
    expect(intents.read(WALLET)?.status).toBe("sent"); // the block is not cleared
  });
});

describe("read-only chain diagnosis", () => {
  const ALT = "8kQVYWq6g7KxYzxhRZ6x9hxJ8DqVfVqNyc4hm4Rn3YJm";
  const rpc: RpcCall = async <T,>(method: string, params: unknown[]): Promise<T> => {
    const answers: Record<string, unknown> = {
      getSlot: 330_000_100,
      getBalance: { value: 10_580_610 },
      getTokenAccountsByOwner: { value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: "6062919" } } } } } }] },
      getSignaturesForAddress: [
        { signature: "SigAlt", slot: 330_000_000, blockTime: 1, err: null },
        { signature: "SigOld", slot: 329_000_000, blockTime: 0, err: null }
      ],
      getAccountInfo: {
        value: {
          owner: ALT_PROGRAM_ID,
          data: { parsed: { info: { addresses: [CLOAK_PROGRAM_ID, CU], authority: WALLET, deactivationSlot: U64_MAX, lastExtendedSlot: "330000000", lastExtendedSlotStartIndex: 0 } } }
        }
      }
    };
    if (method === "getTransaction") {
      const sig = params[0];
      const instructions =
        sig === "SigAlt"
          ? [
              { programId: ALT_PROGRAM_ID, parsed: { type: "createLookupTable", info: { lookupTableAccount: ALT } } },
              { programId: ALT_PROGRAM_ID, parsed: { type: "extendLookupTable", info: { lookupTableAccount: ALT } } }
            ]
          : [{ programId: "11111111111111111111111111111111", parsed: { type: "transfer" } }];
      return { slot: 1, blockTime: 1, meta: { err: null }, transaction: { message: { instructions } } } as T;
    }
    return answers[method] as T;
  };

  it("finds the lookup-table transaction, reads the table, and reports no Cloak deposit", async () => {
    const d = await diagnoseShieldChain(rpc, WALLET, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(d.publicUsdc).toBe(6_062_919n);
    expect(d.solLamports).toBe(10_580_610n);
    expect(d.lookupTableTransaction).toMatchObject({ signature: "SigAlt", kind: "lookup-table", lookupTable: { address: ALT, actions: ["createLookupTable", "extendLookupTable"] } });
    expect(d.lookupTable).toMatchObject({ exists: true, active: true, addresses: [CLOAK_PROGRAM_ID, CU], lastExtendedSlot: 330_000_000, warmedUp: true });
    expect(d.lookupTables.map((t) => t.address)).toEqual([ALT]);
    expect(d.cloakTransactions).toEqual([]);
  });
});
