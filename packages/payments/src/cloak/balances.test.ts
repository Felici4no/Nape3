import { describe, expect, it } from "vitest";
import { address } from "@cloak.dev/sdk";
import { readPublicBalances, type BalanceRpc } from "./balances";

const owner = address("11111111111111111111111111111112");
const mint = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

function fakeRpc(lamports: bigint, amounts: string[]): BalanceRpc {
  return {
    getBalance: () => ({ send: async () => ({ context: { slot: 1n }, value: lamports }) }),
    getTokenAccountsByOwner: () => ({
      send: async () => ({
        context: { slot: 1n },
        value: amounts.map((amount) => ({ account: { data: { parsed: { info: { tokenAmount: { amount } } } } } }))
      })
    })
  } as unknown as BalanceRpc;
}

describe("readPublicBalances", () => {
  it("sums USDC token accounts as bigint and reads SOL", async () => {
    expect(await readPublicBalances(fakeRpc(12_345n, ["5000000", "250000"]), owner, mint)).toEqual({
      publicUsdc: 5_250_000n,
      solLamports: 12_345n
    });
  });

  it("returns zero when the wallet has no USDC account", async () => {
    expect((await readPublicBalances(fakeRpc(0n, []), owner, mint)).publicUsdc).toBe(0n);
  });
});
