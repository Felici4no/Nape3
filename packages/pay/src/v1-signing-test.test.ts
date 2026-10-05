import { describe, expect, it, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519";
import { getBase58Decoder, getBase58Encoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import {
  BroadcastBlockedError,
  buildHarmlessV1,
  cloakAdapterCheck,
  describeShape,
  discoverStandardWallets,
  installBroadcastGuard,
  runV1SigningTest,
  SYSTEM_PROGRAM_ADDRESS,
  type ProviderLike,
  type StandardWallet
} from "./v1-signing-test";
import { walletStandardV1Signer } from "./v1-wallet-signer";

const BLOCKHASH = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";
const OTHER_BLOCKHASH = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const latestBlockhash = async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 100 });
const b58 = getBase58Decoder();

function keypair() {
  const secret = ed25519.utils.randomPrivateKey();
  return { secret, address: b58.decode(ed25519.getPublicKey(secret)) };
}
type Kp = ReturnType<typeof keypair>;

/** Signs v1 wire bytes the way a v1-capable wallet would: signature over the message, appended after it. */
function signWire(wire: Uint8Array, kp: Kp): Uint8Array {
  const { messageBytes } = getTransactionDecoder().decode(wire);
  const out = new Uint8Array(wire);
  out.set(ed25519.sign(new Uint8Array(messageBytes), kp.secret), wire.length - 64);
  return out;
}

function standardWallet(kp: Kp, sign: (wire: Uint8Array) => Promise<unknown>, versions: Array<string | number> = ["legacy", 0, 1]) {
  const signAndSend = { signAndSendTransaction: vi.fn(async () => [{ signature: new Uint8Array(64) }]) };
  const signTransaction = vi.fn(async (input: { transaction: Uint8Array; chain?: string; account: { address: string } }) => {
    expect(input.chain).toBe("solana:mainnet");
    expect(input.account.address).toBe(kp.address);
    return (await sign(input.transaction)) as never;
  });
  const wallet: StandardWallet = {
    name: "Phantom",
    accounts: [{ address: kp.address }],
    features: {
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: versions, signTransaction },
      "solana:signAndSendTransaction": signAndSend
    }
  };
  return { wallet, signTransaction, signAndSend };
}

function guardTarget() {
  const fetch = vi.fn(async () => new Response("{}"));
  return { fetch: fetch as unknown as typeof globalThis.fetch, fetchMock: fetch };
}

describe("harmless Transaction V1", () => {
  it("is a v1 message: the wallet pays, one System transfer of 0 lamports to itself", () => {
    const kp = keypair();
    const { messageBytes } = buildHarmlessV1(kp.address, BLOCKHASH, 100n);
    const message = getCompiledTransactionMessageDecoder().decode(messageBytes) as unknown as {
      version: number;
      staticAccounts: string[];
      instructionHeaders: Array<{ programAccountIndex: number }>;
      instructionPayloads: Array<{ instructionAccountIndices: number[]; instructionData: Uint8Array }>;
    };
    expect(message.version).toBe(1);
    expect(message.staticAccounts).toEqual([kp.address, SYSTEM_PROGRAM_ADDRESS]);
    expect(message.instructionHeaders).toHaveLength(1);
    expect(message.instructionPayloads[0]!.instructionAccountIndices).toEqual([0, 0]);
    expect([...message.instructionPayloads[0]!.instructionData]).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("question B (no prompt): the web3.js-based Cloak adapter cannot re-serialize v1", () => {
    const { wire } = buildHarmlessV1(keypair().address, BLOCKHASH, 100n);
    const b = cloakAdapterCheck(wire);
    expect(b.works).toBe(false);
    expect(b.reason).toMatch(/Serialization of version 1 transaction messages is not supported/);
  });
});

describe("runV1SigningTest", () => {
  it("Wallet Standard signs the unchanged v1 bytes: Phantom YES, Cloak adapter NO (reported separately)", async () => {
    const kp = keypair();
    const { wallet, signTransaction } = standardWallet(kp, async (wire) => [{ signedTransaction: signWire(wire, kp) }]);
    const provider = { request: vi.fn() };
    const target = guardTarget();
    const r = await runV1SigningTest({ walletAddress: kp.address, latestBlockhash, standardWallets: () => [wallet], provider, guardTarget: target });
    expect(r.phantomV1).toBe("PHANTOM_V1_SIGNING_SUPPORTED");
    expect(r.phantomV1Support).toBe("YES");
    expect(r.cloakAdapter.works).toBe(false);
    expect(r.detail).toMatch(/Phantom V1 support: YES\. Current Cloak\/web3\.js adapter: NO/);
    expect(r.walletStandard).toEqual({ found: true, name: "Phantom", signTransactionVersions: ["legacy", 0, 1], declaresV1: true });
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0]).toMatchObject({ path: "wallet-standard", checks: { messageUnchanged: true, stillVersion1: true, signatureValid: true } });
    expect(provider.request).not.toHaveBeenCalled(); // one prompt only
    // the transaction given to the wallet is the v1 wire format
    expect(signTransaction.mock.calls[0]![0].transaction[0]).toBe(0x81);
    expect(r.blockedBroadcasts).toBe(0);
    expect(target.fetchMock).not.toHaveBeenCalled();
    // the signed bytes were discarded (wiped)
    const returned = (await signTransaction.mock.results[0]!.value) as Array<{ signedTransaction: Uint8Array }>;
    expect(returned[0]!.signedTransaction.every((x) => x === 0)).toBe(true);
  });

  it("provider.request sends base58(message bytes), not the full wire transaction, and reads { signature, publicKey }", async () => {
    const kp = keypair();
    let sentMessage: Uint8Array | null = null;
    const provider: ProviderLike = {
      request: vi.fn(async (args: { method: string; params?: unknown }) => {
        expect(args.method).toBe("signTransaction");
        sentMessage = new Uint8Array(getBase58Encoder().encode((args.params as { message: string }).message));
        return { signature: b58.decode(ed25519.sign(sentMessage, kp.secret)), publicKey: kp.address };
      })
    };
    const r = await runV1SigningTest({ walletAddress: kp.address, latestBlockhash, standardWallets: () => [], provider, guardTarget: guardTarget() });
    const { messageBytes, wire } = buildHarmlessV1(kp.address, BLOCKHASH, 100n);
    expect([...sentMessage!]).toEqual([...messageBytes]);
    expect(sentMessage!.length).toBe(wire.length - 64);
    expect(r.phantomV1).toBe("PHANTOM_V1_SIGNING_SUPPORTED");
    expect(r.attempts[0]!.path).toBe("provider-request");
    expect(r.attempts[0]!.responseShape).toMatch(/^object\{signature: string\(8\d, base58→64 bytes\), publicKey: string\(4\d, base58→32 bytes\)\}$/);
  });

  it("regression: 'Reached end of buffer unexpectedly' is DIAGNOSTIC_REQUEST_INVALID, not UNSUPPORTED", async () => {
    const kp = keypair();
    const provider = { request: vi.fn(async () => Promise.reject(new Error("Reached end of buffer unexpectedly"))) };
    const r = await runV1SigningTest({ walletAddress: kp.address, latestBlockhash, standardWallets: () => [], provider, guardTarget: guardTarget() });
    expect(r.phantomV1).toBe("DIAGNOSTIC_REQUEST_INVALID");
    expect(r.phantomV1Support).toBe("UNKNOWN");
    expect(r.attempts[0]!.error).toBe("Reached end of buffer unexpectedly");
  });

  it("an explicit version refusal is UNSUPPORTED", async () => {
    const kp = keypair();
    const provider = { request: async () => Promise.reject(new Error("Unsupported transaction version: 1")) };
    const r = await runV1SigningTest({ walletAddress: kp.address, latestBlockhash, provider, guardTarget: guardTarget() });
    expect(r.phantomV1).toBe("PHANTOM_V1_SIGNING_UNSUPPORTED");
    expect(r.phantomV1Support).toBe("NO");
  });

  it("Wallet Standard refusal (declared versions without 1) is UNSUPPORTED even if the provider route is invalid", async () => {
    const kp = keypair();
    const { wallet } = standardWallet(kp, async () => Promise.reject(new Error("Failed to deserialize transaction")), ["legacy", 0]);
    const provider = { request: vi.fn(async () => Promise.reject(new Error("Reached end of buffer unexpectedly"))) };
    const r = await runV1SigningTest({ walletAddress: kp.address, latestBlockhash, standardWallets: () => [wallet], provider, guardTarget: guardTarget() });
    expect(r.walletStandard.declaresV1).toBe(false);
    expect(r.attempts.map((a) => [a.path, a.outcome])).toEqual([
      ["wallet-standard", "PHANTOM_V1_SIGNING_UNSUPPORTED"],
      ["provider-request", "DIAGNOSTIC_REQUEST_INVALID"]
    ]);
    expect(r.phantomV1).toBe("PHANTOM_V1_SIGNING_UNSUPPORTED");
    expect(r.attempts[0]!.detail).toMatch(/declared supported versions do not include 1/);
  });

  it("user rejection stops the test: INCONCLUSIVE, no second prompt", async () => {
    const kp = keypair();
    const { wallet } = standardWallet(kp, async () => Promise.reject(Object.assign(new Error("User rejected the request."), { code: 4001 })));
    const provider = { request: vi.fn() };
    const r = await runV1SigningTest({ walletAddress: kp.address, latestBlockhash, standardWallets: () => [wallet], provider, guardTarget: guardTarget() });
    expect(r.phantomV1).toBe("INCONCLUSIVE_USER_REJECTED");
    expect(provider.request).not.toHaveBeenCalled();
  });

  it("UNSUPPORTED when the wallet returns a different message, or a signature that does not verify", async () => {
    const kp = keypair();
    const changed = standardWallet(kp, async () => [{ signedTransaction: signWire(buildHarmlessV1(kp.address, OTHER_BLOCKHASH, 5n).wire, kp) }]);
    const r1 = await runV1SigningTest({ walletAddress: kp.address, latestBlockhash, standardWallets: () => [changed.wallet], guardTarget: guardTarget() });
    expect(r1.phantomV1).toBe("PHANTOM_V1_SIGNING_UNSUPPORTED");
    expect(r1.attempts[0]!.checks.messageUnchanged).toBe(false);

    const stranger = keypair();
    const wrongKey = standardWallet(kp, async (wire) => [{ signedTransaction: signWire(wire, stranger) }]);
    const r2 = await runV1SigningTest({ walletAddress: kp.address, latestBlockhash, standardWallets: () => [wrongKey.wallet], guardTarget: guardTarget() });
    expect(r2.attempts[0]!.checks.signatureValid).toBe(false);
    expect(r2.phantomV1).toBe("PHANTOM_V1_SIGNING_UNSUPPORTED");
  });

  it("an unreadable response shape is DIAGNOSTIC_REQUEST_INVALID and its shape is reported without values", async () => {
    const kp = keypair();
    const provider = { request: async () => ({ ok: true, payload: { nested: "AbCdEf" } }) };
    const r = await runV1SigningTest({ walletAddress: kp.address, latestBlockhash, provider, guardTarget: guardTarget() });
    expect(r.phantomV1).toBe("DIAGNOSTIC_REQUEST_INVALID");
    expect(r.attempts[0]!.responseShape).toBe("object{ok: boolean, payload: object{nested: string(6, base58→5 bytes)}}");
    expect(JSON.stringify(r)).not.toContain("AbCdEf");
  });

  it("hard guard: broadcast attempts during the test throw; reads pass; everything is restored", async () => {
    const kp = keypair();
    const target = guardTarget();
    const originalFetch = target.fetch;
    const providerRequest = vi.fn(async () => "ok");
    const provider: ProviderLike & { signAndSendTransaction: () => unknown } = { request: providerRequest, signAndSendTransaction: vi.fn() };
    const attempts: unknown[] = [];
    let ws: ReturnType<typeof standardWallet>;
    ws = standardWallet(kp, async (wire) => {
      await target.fetch("/api/solana-rpc", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: ["AAAA"] }) }).catch((e) => attempts.push(e));
      await Promise.resolve()
        .then(() => (ws.wallet.features["solana:signAndSendTransaction"] as { signAndSendTransaction(): unknown }).signAndSendTransaction())
        .catch((e) => attempts.push(e));
      await Promise.resolve()
        .then(() => provider.request!({ method: "signAndSendTransaction" }))
        .catch((e) => attempts.push(e));
      await Promise.resolve()
        .then(() => provider.signAndSendTransaction())
        .catch((e) => attempts.push(e));
      await target.fetch("/api/solana-rpc", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "getLatestBlockhash", params: [] }) });
      return [{ signedTransaction: signWire(wire, kp) }];
    });
    const originalSignAndSend = ws.signAndSend.signAndSendTransaction;
    const r = await runV1SigningTest({ walletAddress: kp.address, latestBlockhash, standardWallets: () => [ws.wallet], provider, guardTarget: target });
    expect(attempts).toHaveLength(4);
    expect(attempts.every((e) => e instanceof BroadcastBlockedError)).toBe(true);
    expect(r.blockedBroadcasts).toBe(4);
    expect(originalSignAndSend).not.toHaveBeenCalled();
    expect(providerRequest).not.toHaveBeenCalled();
    expect(target.fetchMock).toHaveBeenCalledOnce(); // only the read
    expect(target.fetch).toBe(originalFetch);
    expect(provider.request).toBe(providerRequest);
    expect(ws.signAndSend.signAndSendTransaction).toBe(originalSignAndSend);
    expect(r.phantomV1).toBe("PHANTOM_V1_SIGNING_SUPPORTED");
  });

  it("guard blocks relay submission URLs and XHR sends", async () => {
    const sent: unknown[] = [];
    class FakeXhr {
      open(..._a: unknown[]) {}
      send(body?: unknown) {
        sent.push(body);
      }
    }
    const target = { fetch: vi.fn(async () => new Response("{}")) as unknown as typeof fetch, XMLHttpRequest: FakeXhr as never };
    const restore = installBroadcastGuard(target, [], () => undefined);
    await expect(target.fetch("https://api.cloak.ag/relay/transact?key=s")).rejects.toBeInstanceOf(BroadcastBlockedError);
    const x = new FakeXhr();
    x.open("POST", "/api/solana-rpc");
    expect(() => x.send('{"method":"sendRawTransaction"}')).toThrow(BroadcastBlockedError);
    x.send('{"method":"getSlot"}');
    restore();
    new FakeXhr().send('{"method":"sendTransaction"}');
    expect(sent).toEqual(['{"method":"getSlot"}', '{"method":"sendTransaction"}']);
  });
});

describe("Wallet Standard discovery and shapes", () => {
  it("finds wallets through the app-ready handshake and register-wallet events", () => {
    const target = new EventTarget();
    const a = { name: "Phantom", accounts: [], features: {} } as StandardWallet;
    const b = { name: "Other", accounts: [], features: {} } as StandardWallet;
    target.addEventListener("wallet-standard:app-ready", (e) => (e as CustomEvent<{ register(w: StandardWallet): void }>).detail.register(a));
    target.addEventListener("wallet-standard:app-ready", () => target.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: ({ register }: { register(w: StandardWallet): void }) => register(b) })));
    expect(discoverStandardWallets(target).map((w) => w.name)).toEqual(["Phantom", "Other"]);
  });

  it("describeShape prints types and lengths, never values", () => {
    expect(describeShape([{ signedTransaction: new Uint8Array(214) }])).toBe("[object{signedTransaction: Uint8Array(214)}]");
    expect(describeShape(null)).toBe("null");
  });
});

describe("walletStandardV1Signer (design; not wired into the shield)", () => {
  const tx = (kp: Kp) => {
    const { wire } = buildHarmlessV1(kp.address, BLOCKHASH, 100n);
    const decoded = getTransactionDecoder().decode(wire);
    return { messageBytes: new Uint8Array(decoded.messageBytes), signatures: { ...decoded.signatures } as Record<string, Uint8Array | null> };
  };

  it("passes bytes end to end and returns the wallet's signature on the unchanged message", async () => {
    const kp = keypair();
    const { wallet } = standardWallet(kp, async (wire) => [{ signedTransaction: signWire(wire, kp) }]);
    const signer = walletStandardV1Signer(wallet, wallet.accounts[0]!);
    const input = tx(kp);
    const [out] = await signer.modifyAndSignTransactions([input]);
    expect(out!.messageBytes).toBe(input.messageBytes);
    expect(ed25519.verify(out!.signatures[kp.address]!, input.messageBytes, getBase58Encoder().encode(kp.address) as Uint8Array)).toBe(true);
  });

  it("refuses a changed message or an invalid signature", async () => {
    const kp = keypair();
    const changed = standardWallet(kp, async () => [{ signedTransaction: signWire(buildHarmlessV1(kp.address, OTHER_BLOCKHASH, 5n).wire, kp) }]);
    await expect(walletStandardV1Signer(changed.wallet, changed.wallet.accounts[0]!).modifyAndSignTransactions([tx(kp)])).rejects.toThrow(/changed the transaction message/);
    const unsigned = standardWallet(kp, async (wire) => [{ signedTransaction: wire }]);
    await expect(walletStandardV1Signer(unsigned.wallet, unsigned.wallet.accounts[0]!).modifyAndSignTransactions([tx(kp)])).rejects.toThrow(/does not verify/);
  });
});
