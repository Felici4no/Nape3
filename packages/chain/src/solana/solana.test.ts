import { describe, expect, it } from "vitest";
import {
  base58Decode,
  base58Encode,
  base64Encode,
  broadcastSignedTransaction,
  isSolanaAddress,
  isSolanaSignature,
  MockSolanaRpcProvider,
  readWalletBalances,
  rpcFastFromEnv,
  RpcFastProvider,
  USDC_MINTS,
  verifyTokenTransfer,
  type FetchLike
} from "../index";

const OWNER = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const DEPOSIT = "2VH5VUHmCpGXFj66qVLTpBWqFhDxJNWA53oG65i2mn56";
const USDC = USDC_MINTS["mainnet-beta"];
const SIG = base58Encode(new Uint8Array(64).fill(7));

/** Records JSON-RPC calls and answers from a table. */
function fakeFetch(answers: Record<string, unknown>) {
  const calls: Array<{ url: string; headers: Record<string, string>; method: string; params: unknown[] }> = [];
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(init.body) as { method: string; params: unknown[]; id: number };
    calls.push({ url, headers: init.headers, method: body.method, params: body.params });
    const answer = answers[body.method];
    if (answer instanceof Error) throw answer;
    return { ok: true, status: 200, json: async () => ({ jsonrpc: "2.0", id: body.id, ...(answer && typeof answer === "object" && "error" in answer ? answer : { result: answer }) }) };
  };
  return { fetch, calls };
}

describe("encoding", () => {
  it("round-trips base58 and validates addresses and signatures", () => {
    const bytes = new Uint8Array([0, 0, 1, 2, 255, 128]);
    expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
    expect(isSolanaAddress(OWNER)).toBe(true);
    expect(isSolanaAddress("not-an-address")).toBe(false);
    expect(isSolanaSignature(SIG)).toBe(true);
    expect(isSolanaSignature(OWNER)).toBe(false);
    expect(base64Encode(new Uint8Array([104, 105]))).toBe("aGk=");
  });
});

describe("RpcFastProvider", () => {
  it("reads balances over JSON-RPC and sends the key as a header, not in errors", async () => {
    const { fetch, calls } = fakeFetch({
      getBalance: { value: 50_000_000 },
      getTokenAccountsByOwner: { value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: "25000000" } } } } } }, { account: { data: { parsed: { info: { tokenAmount: { amount: "500000" } } } } } }] }
    });
    const provider = rpcFastFromEnv({ RPC_FAST_URL: "https://solana.example.invalid/rpc", RPC_FAST_API_KEY: "secret-key" }, fetch)!;
    expect(provider).toBeInstanceOf(RpcFastProvider);
    const balances = await readWalletBalances(provider, OWNER, USDC, new Date("2026-10-04T12:00:00Z"));
    expect(balances).toMatchObject({ publicUsdc: 25_500_000n, solLamports: 50_000_000n, provider: "rpc-fast" });
    expect(calls.map((c) => c.method).sort()).toEqual(["getBalance", "getTokenAccountsByOwner"]);
    expect(calls[0]!.headers["x-api-key"]).toBe("secret-key");
  });

  it("never leaks the endpoint (which may embed the key) in errors", async () => {
    const { fetch } = fakeFetch({ getBalance: new TypeError("fetch failed") });
    const provider = new RpcFastProvider({ url: "https://solana.example.invalid/?api_key=SECRET", fetch });
    await expect(provider.getSolBalance(OWNER)).rejects.toThrow(/network error/);
    await provider.getSolBalance(OWNER).catch((e: Error) => expect(e.message).not.toContain("SECRET"));
    const rpcError = fakeFetch({ getBalance: { error: { code: -32602, message: "Invalid param" } } });
    await expect(new RpcFastProvider({ url: "https://x.invalid", fetch: rpcError.fetch }).getSolBalance(OWNER)).rejects.toMatchObject({ code: -32602 });
  });

  it("is not configured without RPC_FAST_URL", () => {
    expect(rpcFastFromEnv({})).toBeNull();
  });

  it("parses transactions for verification and broadcasts signed bytes as base64", async () => {
    const { fetch, calls } = fakeFetch({
      getTransaction: {
        slot: 10,
        blockTime: 1,
        meta: {
          err: null,
          preTokenBalances: [{ accountIndex: 2, mint: USDC, owner: DEPOSIT, uiTokenAmount: { amount: "1000000" } }],
          postTokenBalances: [{ accountIndex: 2, mint: USDC, owner: DEPOSIT, uiTokenAmount: { amount: "4722223" } }]
        },
        transaction: { message: { accountKeys: [{ pubkey: OWNER, signer: true }, { pubkey: DEPOSIT, signer: false }] } }
      },
      sendTransaction: SIG
    });
    const provider = new RpcFastProvider({ url: "https://x.invalid", fetch });
    expect(await verifyTokenTransfer(provider, SIG, { mint: USDC, destinationOwner: DEPOSIT, minAmount: 3_722_223n })).toEqual({ status: "confirmed", received: 3_722_223n, slot: 10 });
    expect(await verifyTokenTransfer(provider, SIG, { mint: USDC, destinationOwner: DEPOSIT, minAmount: 4_000_000n })).toMatchObject({ status: "failed" });
    const raw = new Uint8Array(100).fill(1);
    expect(await broadcastSignedTransaction(provider, raw)).toBe(SIG);
    expect(calls.at(-1)).toMatchObject({ method: "sendTransaction", params: [base64Encode(raw), { encoding: "base64" }] });
  });
});

describe("MockSolanaRpcProvider", () => {
  it("serves balances, pending/confirmed/failed transactions and refuses unsigned broadcasts", async () => {
    const chain = new MockSolanaRpcProvider().setSol(OWNER, 10n).setToken(OWNER, USDC, 5n);
    expect(await readWalletBalances(chain, OWNER, USDC)).toMatchObject({ publicUsdc: 5n, solLamports: 10n });
    expect(await verifyTokenTransfer(chain, SIG, { mint: USDC, destinationOwner: DEPOSIT, minAmount: 1n })).toEqual({ status: "pending" });
    chain.addTransaction({ signature: SIG, slot: 1, blockTime: null, failed: true, error: "InstructionError", signers: [OWNER], preTokenBalances: [], postTokenBalances: [] });
    expect(await verifyTokenTransfer(chain, SIG, { mint: USDC, destinationOwner: DEPOSIT, minAmount: 1n })).toMatchObject({ status: "failed" });
    expect(await verifyTokenTransfer(chain, "bad", { mint: USDC, destinationOwner: DEPOSIT, minAmount: 1n })).toMatchObject({ status: "failed" });
    await expect(broadcastSignedTransaction(chain, new Uint8Array(10))).rejects.toThrow(/too short/);
    await expect(broadcastSignedTransaction(chain, new Uint8Array(2000).fill(1))).rejects.toThrow(/exceeds/);
  });
});
