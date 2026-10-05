import { describe, expect, it, vi } from "vitest";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash
} from "@solana/kit";
import { BLOCKED_SEND_ERROR_CODE, captureTransport } from "./rpc-capture";
import {
  assertNoUserFundedAlt,
  CLOAK_RELAY_ORIGIN,
  DEFAULT_FRESHNESS,
  dryRunModifyingSigner,
  guardedWalletSigner,
  inspectRangeQuote,
  quoteFreshness,
  RelayShieldAbort,
  RelayShieldGuard,
  type ModifyingSigner
} from "./relay-shield-guard";
import { relayVerdict } from "./runtime";
import { ALT_PROGRAM_ID, CLOAK_PROGRAM_ID } from "./shield-diagnosis";
import { decodeTransaction, base64ToBytes } from "./tx-decode";

const WALLET = address("9qAezschd4e5t5yi9F5SAw41g43Vuj6iYMh7dpcKqkUi");
const POOL = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const TABLE = address("GLVcKLgw5rRsa6eWNXwNqMzP4tX8zXgfEMCx9837aan3");
const RELAY_TABLE = "RelayTab1e111111111111111111111111111111111";
const lifetime = { blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM" as Blockhash, lastValidBlockHeight: 1n };

type KitTx = { messageBytes: Uint8Array; signatures: Record<string, Uint8Array | null> };

function kitTx(version: "legacy" | 0 | 1, programAddress: string, data = new Uint8Array(8)): KitTx {
  const msg = pipe(
    createTransactionMessage({ version }),
    (m) => setTransactionMessageFeePayer(WALLET, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) => appendTransactionMessageInstructions([{ programAddress: address(programAddress), accounts: [{ address: POOL, role: AccountRole.WRITABLE }], data }], m)
  );
  return compileTransaction(msg as Parameters<typeof compileTransaction>[0]) as unknown as KitTx;
}

/** CreateLookupTable (tag 0) + ExtendLookupTable (tag 2): what the SDK's createEphemeralALT asks the wallet to sign. */
const altTx = () => {
  const msg = pipe(
    createTransactionMessage({ version: "legacy" }),
    (m) => setTransactionMessageFeePayer(WALLET, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetime, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          { programAddress: address(ALT_PROGRAM_ID), accounts: [{ address: TABLE, role: AccountRole.WRITABLE }], data: new Uint8Array([0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 255]) },
          { programAddress: address(ALT_PROGRAM_ID), accounts: [{ address: TABLE, role: AccountRole.WRITABLE }], data: new Uint8Array([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) }
        ],
        m
      )
  );
  return compileTransaction(msg as Parameters<typeof compileTransaction>[0]) as unknown as KitTx;
};
const depositTx = () => kitTx(0, CLOAK_PROGRAM_ID);
const wire = (tx: KitTx) => getBase64EncodedWireTransaction(tx as never);
const decoded = (tx: KitTx) => decodeTransaction(base64ToBytes(wire(tx)));

function walletSigner() {
  const inner = { address: WALLET, modifyAndSignTransactions: vi.fn(async (txs: readonly KitTx[]) => txs) } satisfies ModifyingSigner;
  return inner;
}

/** A 146-byte deposit quote message with an issued-at and an expiry (layout here is illustrative). */
function quoteHex(fetchMs: number, expiresInSec: number): string {
  const bytes = new Uint8Array(146);
  bytes[0] = 1;
  const view = new DataView(bytes.buffer);
  view.setBigInt64(65, BigInt(Math.floor(fetchMs / 1000) - 1), true);
  view.setBigInt64(73, BigInt(Math.floor(fetchMs / 1000) + expiresInSec), true);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function guardWithQuote(now: { t: number }, expiresInSec = 599, mode: "live" | "dry-run" | "relay-test" = "live") {
  const guard = new RelayShieldGuard({ mode, now: () => now.t });
  guard.quote = inspectRangeQuote(quoteHex(now.t, expiresInSec), now.t);
  return guard;
}

describe("invariant: a wallet-funded lookup table can never be signed or sent", () => {
  it("assertNoUserFundedAlt refuses any transaction invoking the ALT program", () => {
    const tx = decoded(altTx());
    expect(tx.altInstructions).toEqual(["CreateLookupTable", "ExtendLookupTable"]);
    expect(() => assertNoUserFundedAlt(tx)).toThrow(RelayShieldAbort);
    expect(() => assertNoUserFundedAlt(decoded(depositTx()))).not.toThrow();
  });

  it("outside any attempt, the app's wallet signer still refuses it (the wallet is never asked)", async () => {
    const inner = walletSigner();
    const signer = guardedWalletSigner(inner, () => null);
    await expect(signer.modifyAndSignTransactions([altTx()])).rejects.toMatchObject({ violation: "USER_FUNDED_ALT_BLOCKED" });
    expect(inner.modifyAndSignTransactions).not.toHaveBeenCalled();
    await signer.modifyAndSignTransactions([depositTx()]);
    expect(inner.modifyAndSignTransactions).toHaveBeenCalledOnce();
  });

  it("during an attempt, the guard refuses it before the wallet is asked", async () => {
    const inner = walletSigner();
    const guard = guardWithQuote({ t: 1_791_000_000_000 });
    await expect(guard.wrapSigner(inner).modifyAndSignTransactions([altTx()])).rejects.toMatchObject({ violation: "USER_FUNDED_ALT_BLOCKED", beforeBroadcast: true });
    expect(inner.modifyAndSignTransactions).not.toHaveBeenCalled();
    expect(guard.violation).toBe("USER_FUNDED_ALT_BLOCKED");
  });

  it("the transport never forwards it (live) nor simulates it (simulate-only)", async () => {
    for (const mode of ["live", "simulate-only"] as const) {
      const base = vi.fn(async () => ({ jsonrpc: "2.0", id: 1, result: "SIG" }));
      const t = captureTransport(base, mode, { inspectSend: assertNoUserFundedAlt });
      const response = (await t({ payload: { jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [wire(altTx()), { encoding: "base64" }] } })) as { error?: { code: number; message: string } };
      expect(response.error?.code).toBe(BLOCKED_SEND_ERROR_CODE);
      expect(base).not.toHaveBeenCalled();
    }
    const base = vi.fn(async () => ({ jsonrpc: "2.0", id: 1, result: "SIG" }));
    const t = captureTransport(base, "live", { inspectSend: assertNoUserFundedAlt });
    await t({ payload: { jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [wire(depositTx()), { encoding: "base64" }] } });
    expect(base).toHaveBeenCalledOnce();
  });

  it("each exact SDK 0.2.5 fallback announcement aborts the attempt", () => {
    for (const line of [
      "Relay supplemental ALT failed (Supplemental ALT request failed (503)); falling back to a depositor-signed table.",
      "Relay lookup table failed (boom); falling back to a depositor-signed table.",
      "Relay supplemental table leaves the transaction at 1300 bytes; falling back to a depositor-signed table.",
      "Creating address lookup table for V0 transaction...",
      "Waiting for wallet signature (lookup table)..."
    ]) {
      const guard = new RelayShieldGuard({ mode: "live" });
      expect(() => guard.onProgress(line)).toThrow(RelayShieldAbort);
      expect(guard.violation).toBe("RELAY_ALT_FALLBACK_BLOCKED");
    }
    const guard = new RelayShieldGuard({ mode: "live" });
    expect(() => guard.onProgress("Requesting supplemental lookup table from relay...")).not.toThrow();
  });

  /**
   * The SDK's flow, reduced to what matters here (index.js 0.2.5,
   * submitTransactionDirect + planDirectV0Submission + createEphemeralALT):
   * quote → relay table → on failure announce the fallback and sign + send a
   * CreateLookupTable/ExtendLookupTable with the depositor.
   */
  async function sdkLikeDeposit(deps: {
    fetch: typeof fetch;
    signer: ModifyingSigner;
    send: (wireTx: string) => Promise<unknown>;
    onProgress: (s: string) => void;
    announceFallback?: boolean;
  }): Promise<string> {
    deps.onProgress("Fetching risk quote from backend...");
    await deps.fetch(`${CLOAK_RELAY_ORIGIN}/range-quote?wallet=${WALLET}`);
    deps.onProgress("Requesting supplemental lookup table from relay...");
    const relay = await deps.fetch(`${CLOAK_RELAY_ORIGIN}/supplemental-alt`, {
      method: "POST",
      body: JSON.stringify({ mint: "EPjF", depositor: WALLET, nullifiers: ["aa", "bb"], bind0: "00".repeat(32) })
    });
    if (!relay.ok) {
      if (deps.announceFallback !== false) deps.onProgress("Relay supplemental ALT failed (Supplemental ALT request failed (503)); falling back to a depositor-signed table.");
      const [signed] = await deps.signer.modifyAndSignTransactions([altTx()]);
      await deps.send(wire(signed!));
    }
    deps.onProgress("Waiting for wallet signature...");
    const [signed] = await deps.signer.modifyAndSignTransactions([depositTx()]);
    await deps.send(wire(signed!));
    return "SIG";
  }

  function relayServer(relayOk: boolean) {
    const now = Date.now();
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/range-quote")) return new Response(JSON.stringify({ message: quoteHex(now, 599), signature: "x", signer_pubkey: "y" }));
      if (url.includes("/supplemental-alt")) return relayOk ? new Response(JSON.stringify({ table: RELAY_TABLE })) : new Response("relay down", { status: 500 });
      return new Response("{}");
    });
  }

  for (const scenario of ["fallback announced", "fallback NOT announced (future SDK wording)"] as const) {
    it(`relay failure, ${scenario}: the wallet is never asked and nothing is sent`, async () => {
      const target = { fetch: relayServer(false) as unknown as typeof fetch };
      const inner = walletSigner();
      const base = vi.fn(async () => ({ jsonrpc: "2.0", id: 1, result: "SIG" }));
      const guard = new RelayShieldGuard({ mode: "live" });
      const transport = captureTransport(base, "live", { inspectSend: (tx) => guard.inspectSend(tx) });
      const restore = guard.installFetchObserver(target);
      const error = await sdkLikeDeposit({
        fetch: target.fetch,
        signer: guardedWalletSigner(inner, () => guard),
        send: (w) => transport({ payload: { jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [w, { encoding: "base64" }] } }),
        onProgress: (s) => guard.onProgress(s),
        announceFallback: scenario === "fallback announced"
      }).catch((e: unknown) => e);
      restore();
      expect(error).toBeInstanceOf(RelayShieldAbort);
      expect(inner.modifyAndSignTransactions).not.toHaveBeenCalled();
      expect(base).not.toHaveBeenCalled();
      expect(guard.relayFailed).toBe("HTTP 500");
      // announced: stopped at the progress line; not announced: stopped by the signer guard on the ALT transaction
      expect(guard.violation).toBe(scenario === "fallback announced" ? "RELAY_ALT_FALLBACK_BLOCKED" : "USER_FUNDED_ALT_BLOCKED");
    });
  }

  it("relay success: one wallet signature (the deposit), sent once, through the relay table", async () => {
    const target = { fetch: relayServer(true) as unknown as typeof fetch };
    const inner = walletSigner();
    const base = vi.fn(async () => ({ jsonrpc: "2.0", id: 1, result: "SIG" }));
    const stages: string[] = [];
    const guard = new RelayShieldGuard({ mode: "live", onStage: (s) => stages.push(s) });
    const transport = captureTransport(base, "live", { inspectSend: (tx) => guard.inspectSend(tx) });
    const restore = guard.installFetchObserver(target);
    await sdkLikeDeposit({
      fetch: target.fetch,
      signer: guardedWalletSigner(inner, () => guard),
      send: (w) => transport({ payload: { jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [w, { encoding: "base64" }] } }),
      onProgress: (s) => guard.onProgress(s)
    });
    restore();
    expect(inner.modifyAndSignTransactions).toHaveBeenCalledOnce();
    expect(base).toHaveBeenCalledOnce();
    expect(guard.relayTable).toBe(RELAY_TABLE);
    expect(guard.relayRequest).toEqual({ mint: "EPjF", depositor: WALLET, nullifiers: 2, bind0Bytes: 32 });
    expect(stages).toEqual(["FETCHING_RISK_QUOTE", "PREPARING_RELAY_ALT", "PREPARING_RELAY_ALT", "WAITING_FOR_ALT_WARMUP", "CHECKING_QUOTE_FRESHNESS", "WALLET_SIGNATURE_REQUIRED"]);
    expect(guard.report().violation).toBeNull();
  });
});

describe("relay prefetch failure alone does not stop a deposit that fits", () => {
  it("signs the deposit when no fallback is attempted", async () => {
    const now = { t: 1_791_000_000_000 };
    const guard = guardWithQuote(now);
    guard.relayFailed = "HTTP 500";
    const inner = walletSigner();
    await guard.wrapSigner(inner).modifyAndSignTransactions([depositTx()]);
    expect(inner.modifyAndSignTransactions).toHaveBeenCalledOnce();
  });
});

describe("one approval: no automatic re-sign", () => {
  it("a second signature in the same attempt is refused (the SDK's blockhash/transport retry)", async () => {
    const now = { t: 1_791_000_000_000 };
    const inner = walletSigner();
    const signer = guardWithQuote(now).wrapSigner(inner);
    await signer.modifyAndSignTransactions([depositTx()]);
    await expect(signer.modifyAndSignTransactions([depositTx()])).rejects.toMatchObject({ violation: "SECOND_SIGNATURE_BLOCKED", beforeBroadcast: false });
    expect(inner.modifyAndSignTransactions).toHaveBeenCalledOnce();
  });

  it("only a v0 Cloak deposit may be signed during an attempt", async () => {
    for (const tx of [kitTx(1, CLOAK_PROGRAM_ID), kitTx("legacy", CLOAK_PROGRAM_ID), kitTx(0, "11111111111111111111111111111111")]) {
      const inner = walletSigner();
      await expect(guardWithQuote({ t: 1_791_000_000_000 }).wrapSigner(inner).modifyAndSignTransactions([tx])).rejects.toMatchObject({ violation: "UNEXPECTED_TRANSACTION" });
      expect(inner.modifyAndSignTransactions).not.toHaveBeenCalled();
    }
  });
});

describe("risk-quote freshness", () => {
  it("reads timestamp candidates and the expiry out of the signed quote message", () => {
    const fetched = 1_791_000_000_000;
    const q = inspectRangeQuote(quoteHex(fetched, 90), fetched);
    expect(q.messageLength).toBe(146);
    expect(q.tag).toBe(1);
    expect(q.timestampCandidates.map((c) => [c.offset, c.secondsFromFetch])).toEqual([
      [65, -1],
      [73, 90]
    ]);
    expect(q.expiresAtMs).toBe((Math.floor(fetched / 1000) + 90) * 1000);
  });

  it("stale before the prompt: the wallet is not asked", async () => {
    const now = { t: 1_791_000_000_000 };
    const guard = guardWithQuote(now);
    now.t += DEFAULT_FRESHNESS.maxAgeAtPromptMs + 1;
    const inner = walletSigner();
    await expect(guard.wrapSigner(inner).modifyAndSignTransactions([depositTx()])).rejects.toMatchObject({ violation: "RISK_QUOTE_STALE", beforeBroadcast: true });
    expect(inner.modifyAndSignTransactions).not.toHaveBeenCalled();
  });

  it("too close to expiry after the wallet returns: aborted before the SDK can send", async () => {
    const now = { t: 1_791_000_000_000 };
    const guard = guardWithQuote(now, 150); // 150 s left at the prompt (≥ 120 s)
    const inner = { address: WALLET, modifyAndSignTransactions: vi.fn(async (txs: readonly KitTx[]) => ((now.t += 100_000), txs)) }; // 50 s left after (< 60 s)
    await expect(guard.wrapSigner(inner).modifyAndSignTransactions([depositTx()])).rejects.toMatchObject({ violation: "RISK_QUOTE_STALE", beforeBroadcast: true });
    expect(inner.modifyAndSignTransactions).toHaveBeenCalledOnce();
  });

  it("the measured relay quote (599 s) leaves minutes for the approval", () => {
    const fetched = 1_791_000_000_000;
    const q = inspectRangeQuote(quoteHex(fetched, 599), fetched);
    expect(quoteFreshness(q, fetched + 2_740, "prompt").fresh).toBe(true); // observed: 2.7 s from quote to prompt
    expect(quoteFreshness(q, fetched + 4 * 60_000, "send").fresh).toBe(true); // a 4-minute approval still sends
    expect(quoteFreshness(q, fetched + 6 * 60_000, "send").fresh).toBe(false); // past the send limit: abort, nothing broadcast
  });

  it("no quote observed counts as stale; a fresh one passes", () => {
    expect(quoteFreshness(null, 0, "prompt").fresh).toBe(false);
    const fetched = 1_791_000_000_000;
    expect(quoteFreshness(inspectRangeQuote(quoteHex(fetched, 599), fetched), fetched + 5_000, "prompt")).toMatchObject({ fresh: true, ageMs: 5_000 });
  });
});

describe("fetch observer", () => {
  it("dry-run answers /supplemental-alt locally (never sent) and still records the request", async () => {
    const original = vi.fn(async () => new Response("{}"));
    const target = { fetch: original as unknown as typeof fetch };
    const guard = new RelayShieldGuard({ mode: "dry-run" });
    const restore = guard.installFetchObserver(target);
    const res = await target.fetch(`${CLOAK_RELAY_ORIGIN}/supplemental-alt`, { method: "POST", body: JSON.stringify({ mint: "m", depositor: WALLET, nullifiers: ["a", "b"], bind0: "11".repeat(32) }) });
    expect(res.status).toBe(503);
    expect(original).not.toHaveBeenCalled();
    expect(guard.relayRequest).toEqual({ mint: "m", depositor: WALLET, nullifiers: 2, bind0Bytes: 32 });
    expect(guard.relayFailed).toMatch(/dry run/);
    // other requests pass through
    await target.fetch("/api/solana-rpc", { method: "POST", body: "{}" });
    expect(original).toHaveBeenCalledOnce();
    restore();
    expect(target.fetch).toBe(original);
  });

  it("relay-test forwards /supplemental-alt for real and records the table", async () => {
    const original = vi.fn(async () => new Response(JSON.stringify({ table: RELAY_TABLE })));
    const target = { fetch: original as unknown as typeof fetch };
    const guard = new RelayShieldGuard({ mode: "relay-test" });
    const restore = guard.installFetchObserver(target);
    await target.fetch(`${CLOAK_RELAY_ORIGIN}/supplemental-alt`, { method: "POST", body: "{}" });
    restore();
    expect(original).toHaveBeenCalledOnce();
    expect(guard.relayTable).toBe(RELAY_TABLE);
    expect(guard.stage).toBe("WAITING_FOR_ALT_WARMUP");
  });

  it("the zero-signature dry-run signer never touches a wallet", async () => {
    const [tx] = await dryRunModifyingSigner(WALLET).modifyAndSignTransactions([depositTx()]);
    expect(tx!.signatures[WALLET]).toEqual(new Uint8Array(64));
  });
});

describe("relayVerdict", () => {
  const report = (patch: Partial<ReturnType<RelayShieldGuard["report"]>>) => ({ ...new RelayShieldGuard({ mode: "dry-run" }).report(), ...patch });
  const body = { mint: "m", depositor: WALLET, nullifiers: 2, bind0Bytes: 32 };
  const deposit = (ok: boolean, tables: string[] = []) => ({
    ok,
    rpcRejected: false,
    diagnostic: { message: ok ? "ok" : "failed" } as never,
    transaction: { ...decoded(depositTx()), lookupTables: tables.map((table) => ({ table, writable: 1, readonly: 1 })) }
  });

  it("dry run is READY only with a valid relay body and the fallback blocked", () => {
    expect(relayVerdict("dry-run", report({ relayRequest: body, violation: "RELAY_ALT_FALLBACK_BLOCKED" }), [], "x").verdict).toBe("READY_UP_TO_RELAY_ALT");
    expect(relayVerdict("dry-run", report({ relayRequest: { ...body, bind0Bytes: 0 }, violation: "RELAY_ALT_FALLBACK_BLOCKED" }), [], "x").verdict).toBe("STOPPED");
    expect(relayVerdict("dry-run", report({}), [], "no nonce").verdict).toBe("RELAY_ALT_NOT_REQUESTED");
    expect(relayVerdict("dry-run", report({}), [deposit(true)], null).verdict).toBe("FITS_WITHOUT_RELAY_ALT");
    // the SDK prefetches the table; a deposit that fit without it is still FITS, not a failure
    expect(relayVerdict("dry-run", report({ relayRequest: body, relayFailed: "dry run" }), [deposit(true)], null).verdict).toBe("FITS_WITHOUT_RELAY_ALT");
  });

  it("relay test reports the deposit simulated with the relay table", () => {
    expect(relayVerdict("relay-test", report({ mode: "relay-test", relayRequest: body, relayTable: RELAY_TABLE }), [deposit(true, [RELAY_TABLE])], null).verdict).toBe("RELAY_ALT_DEPOSIT_WOULD_SUCCEED");
    expect(relayVerdict("relay-test", report({ mode: "relay-test", relayRequest: body, relayTable: RELAY_TABLE }), [deposit(false, [RELAY_TABLE])], null).verdict).toBe("RELAY_ALT_DEPOSIT_WOULD_FAIL");
    expect(relayVerdict("relay-test", report({ mode: "relay-test", relayRequest: body, relayTable: RELAY_TABLE }), [deposit(true)], null).verdict).toBe("FITS_WITHOUT_RELAY_ALT");
    expect(relayVerdict("relay-test", report({ mode: "relay-test", relayRequest: body, relayFailed: "HTTP 500" }), [], null).verdict).toBe("RELAY_ALT_FAILED");
  });
});
