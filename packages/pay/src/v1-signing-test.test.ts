import { describe, expect, it, vi } from "vitest";
import { VersionedTransaction } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import { getBase58Decoder, getBase58Encoder, getCompiledTransactionMessageDecoder } from "@solana/kit";
import { BroadcastBlockedError, buildHarmlessV1, installBroadcastGuard, runV1SigningTest, SYSTEM_PROGRAM_ADDRESS, type SigningWallet } from "./v1-signing-test";

const BLOCKHASH = "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM";
const latestBlockhash = async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 100 });
const b58 = getBase58Decoder();

function keypair() {
  const secret = ed25519.utils.randomPrivateKey();
  const pub = ed25519.getPublicKey(secret);
  return { secret, address: b58.decode(pub), publicKey: { toBase58: () => b58.decode(pub) } };
}

/** What a v1-capable wallet sees: the message bytes (deterministic for the same inputs). */
function signedWire(kp: ReturnType<typeof keypair>, blockhash = BLOCKHASH, height = 100n) {
  const { wire, messageBytes } = buildHarmlessV1(kp.address, blockhash, height);
  const signature = ed25519.sign(messageBytes, kp.secret);
  const out = new Uint8Array(wire);
  out.set(signature, wire.length - 64); // v1 wire: message, then signatures
  return { wire: out, signature, messageBytes };
}

function wallet(sign: (tx: unknown, kp: ReturnType<typeof keypair>) => Promise<unknown>, extra: Partial<SigningWallet> = {}) {
  const kp = keypair();
  const returned: unknown[] = [];
  const w: SigningWallet = {
    publicKey: kp.publicKey,
    signTransaction: async (tx) => {
      const out = await sign(tx, kp);
      returned.push(out);
      return out;
    },
    ...extra
  };
  return { w, kp, returned };
}

/** Returns the page's web3.js VersionedTransaction with the signature set (its serialize() throws for v1 in web3.js 1.99). */
const signsWeb3Object = async (tx: unknown, kp: ReturnType<typeof keypair>) => {
  (tx as VersionedTransaction).signatures[0] = signedWire(kp).signature;
  return tx;
};

/** Returns an object of a v1-capable class (serialize works). */
const signsV1Capable = async (_tx: unknown, kp: ReturnType<typeof keypair>) => {
  const { wire, signature } = signedWire(kp);
  return { version: 1, message: { version: 1 }, signatures: [signature], serialize: () => new Uint8Array(wire) };
};

function guardTarget() {
  const fetch = vi.fn(async () => new Response("{}"));
  return { fetch: fetch as unknown as typeof globalThis.fetch, fetchMock: fetch };
}

describe("harmless Transaction V1", () => {
  it("is a v1 message: the wallet pays, one System transfer of 0 lamports to itself", () => {
    const kp = keypair();
    const { wire, messageBytes } = buildHarmlessV1(kp.address, BLOCKHASH, 100n);
    const message = getCompiledTransactionMessageDecoder().decode(messageBytes) as unknown as {
      version: number;
      staticAccounts: string[];
      instructionHeaders: Array<{ programAccountIndex: number }>;
      instructionPayloads: Array<{ instructionAccountIndices: number[]; instructionData: Uint8Array }>;
    };
    expect(message.version).toBe(1);
    expect(message.staticAccounts).toEqual([kp.address, SYSTEM_PROGRAM_ADDRESS]);
    expect(message.instructionHeaders).toHaveLength(1);
    expect(message.staticAccounts[message.instructionHeaders[0]!.programAccountIndex]).toBe(SYSTEM_PROGRAM_ADDRESS);
    expect(message.instructionPayloads[0]!.instructionAccountIndices).toEqual([0, 0]);
    expect([...message.instructionPayloads[0]!.instructionData]).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // web3.js 1.99 (what the SDK's wallet adapter hands to Phantom) loads it, but cannot serialize it again
    const tx = VersionedTransaction.deserialize(wire);
    expect(tx.version).toBe(1);
    expect(tx.message.staticAccountKeys.map(String)).toEqual([kp.address, SYSTEM_PROGRAM_ADDRESS]);
    expect(() => tx.serialize()).toThrow(/version 1/);
  });
});

describe("runV1SigningTest", () => {
  it("SUPPORTED, with the SDK-path caveat, when the wallet signs and returns the web3.js object", async () => {
    const { w, returned } = wallet(signsWeb3Object);
    const target = guardTarget();
    const r = await runV1SigningTest({ wallet: w, latestBlockhash, guardTarget: target });
    expect(r.outcome).toBe("PHANTOM_V1_SIGNING_SUPPORTED");
    expect(r.path).toBe("sdk-adapter");
    expect(r.checks).toEqual({ walletReturned: true, messageUnchanged: true, stillVersion1: true, signatureValid: true });
    expect(r.sdkAdapterPathWorks).toBe(false);
    expect(r.inPageErrors.join(" ")).toMatch(/signed\.serialize\(\).*version 1/);
    expect(r.detail).toMatch(/adapter that passes raw bytes/);
    expect(r.blockedBroadcasts).toBe(0);
    expect(target.fetchMock).not.toHaveBeenCalled();
    // discarded: the signature held by the returned object has been overwritten
    expect((returned[0] as VersionedTransaction).signatures[0]!.every((b) => b === 0)).toBe(true);
  });

  it("SUPPORTED with the SDK path working when the result serializes; message bytes compared", async () => {
    const { w } = wallet(signsV1Capable);
    const r = await runV1SigningTest({ wallet: w, latestBlockhash, guardTarget: guardTarget() });
    expect(r.outcome).toBe("PHANTOM_V1_SIGNING_SUPPORTED");
    expect(r.sdkAdapterPathWorks).toBe(true);
    expect(r.detail).not.toMatch(/raw bytes/);
  });

  it("falls back to raw bytes when the provider fails in this page before reaching the wallet", async () => {
    const request = vi.fn(async (args: { method: string; params?: unknown }) => {
      expect(args.method).toBe("signTransaction");
      const sent = new Uint8Array(getBase58Encoder().encode((args.params as { message: string }).message));
      expect(sent[0]).toBe(0x81); // v1 prefix: the wallet gets the v1 bytes
      return { signature: b58.decode(signedWire(kp).signature) };
    });
    const { w, kp } = wallet(async (tx) => (tx as VersionedTransaction).serialize(), {});
    w.request = request;
    const r = await runV1SigningTest({ wallet: w, latestBlockhash, guardTarget: guardTarget() });
    expect(request).toHaveBeenCalledOnce();
    expect(r.path).toBe("raw-bytes");
    expect(r.sdkAdapterPathWorks).toBe(false);
    expect(r.outcome).toBe("PHANTOM_V1_SIGNING_SUPPORTED");
  });

  it("raw-bytes fallback accepts a signed transaction back", async () => {
    const { w, kp } = wallet(async (tx) => (tx as VersionedTransaction).serialize());
    w.request = async () => ({ signedTransaction: b58.decode(signedWire(kp).wire) });
    const r = await runV1SigningTest({ wallet: w, latestBlockhash, guardTarget: guardTarget() });
    expect(r.outcome).toBe("PHANTOM_V1_SIGNING_SUPPORTED");
    expect(r.checks.messageUnchanged).toBe(true);
  });

  it("UNSUPPORTED when the wallet throws on the v1 transaction", async () => {
    const { w } = wallet(async () => {
      throw new Error("Unsupported transaction version: 1");
    });
    const r = await runV1SigningTest({ wallet: w, latestBlockhash, guardTarget: guardTarget() });
    expect(r.outcome).toBe("PHANTOM_V1_SIGNING_UNSUPPORTED");
    expect(r.detail).toMatch(/Unsupported transaction version/);
    expect(r.checks.walletReturned).toBe(false);
  });

  it("INCONCLUSIVE when the user rejects the request", async () => {
    const { w } = wallet(async () => {
      throw Object.assign(new Error("User rejected the request."), { code: 4001 });
    });
    const r = await runV1SigningTest({ wallet: w, latestBlockhash, guardTarget: guardTarget() });
    expect(r.outcome).toBe("INCONCLUSIVE_USER_REJECTED");
  });

  it("UNSUPPORTED when the wallet returns a different message", async () => {
    const { w } = wallet(async (_tx, kp) => {
      const other = signedWire(kp, "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", 5n);
      return { version: 1, message: { version: 1, serialize: () => other.messageBytes }, signatures: [other.signature] };
    });
    const r = await runV1SigningTest({ wallet: w, latestBlockhash, guardTarget: guardTarget() });
    expect(r.outcome).toBe("PHANTOM_V1_SIGNING_UNSUPPORTED");
    expect(r.checks.messageUnchanged).toBe(false);
  });

  it("UNSUPPORTED when the signature does not verify (wrong key or zeros)", async () => {
    const stranger = keypair();
    const { w } = wallet(async (tx) => {
      (tx as VersionedTransaction).signatures[0] = signedWire(stranger).signature;
      return tx;
    });
    const r = await runV1SigningTest({ wallet: w, latestBlockhash, guardTarget: guardTarget() });
    expect(r.outcome).toBe("PHANTOM_V1_SIGNING_UNSUPPORTED");
    expect(r.checks.signatureValid).toBe(false);

    const zeros = wallet(async (tx) => tx); // unsigned: all-zero signature
    expect((await runV1SigningTest({ wallet: zeros.w, latestBlockhash, guardTarget: guardTarget() })).checks.signatureValid).toBe(false);
  });

  it("hard guard: broadcast attempts during the test throw; reads pass; everything is restored", async () => {
    const target = guardTarget();
    const originalFetch = target.fetch;
    const provider = {
      signAndSendTransaction: vi.fn(async () => ({ signature: "x" })),
      sendTransaction: vi.fn(async () => "x"),
      request: vi.fn(async () => "ok")
    };
    const originalRequest = provider.request;
    const attempts: unknown[] = [];
    const { w } = wallet(async (tx, kp) => {
      await target.fetch("/api/solana-rpc", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: ["AAAA"] }) }).catch((e) => attempts.push(e));
      await Promise.resolve()
        .then(() => (provider as unknown as { signAndSendTransaction(t: unknown): unknown }).signAndSendTransaction(tx))
        .catch((e) => attempts.push(e));
      await Promise.resolve()
        .then(() => (provider as unknown as { request(a: unknown): unknown }).request({ method: "signAndSendTransaction" }))
        .catch((e) => attempts.push(e));
      await target.fetch("/api/solana-rpc", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "getLatestBlockhash", params: [] }) });
      return signsWeb3Object(tx, kp);
    });
    const r = await runV1SigningTest({ wallet: w, latestBlockhash, guardTarget: target, guardWallet: provider });
    expect(attempts).toHaveLength(3);
    expect(attempts.every((e) => e instanceof BroadcastBlockedError)).toBe(true);
    expect(r.blockedBroadcasts).toBe(3);
    expect(provider.signAndSendTransaction).not.toHaveBeenCalled();
    expect(originalRequest).not.toHaveBeenCalled();
    expect(target.fetchMock).toHaveBeenCalledOnce(); // only the read
    expect(target.fetch).toBe(originalFetch);
    expect(provider.request).toBe(originalRequest);
    expect(r.outcome).toBe("PHANTOM_V1_SIGNING_SUPPORTED");
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
    const restore = installBroadcastGuard(target, {}, () => undefined);
    await expect(target.fetch("https://api.cloak.ag/relay/transact?key=s")).rejects.toBeInstanceOf(BroadcastBlockedError);
    const x = new FakeXhr();
    x.open("POST", "/api/solana-rpc");
    expect(() => x.send('{"method":"sendRawTransaction"}')).toThrow(BroadcastBlockedError);
    x.send('{"method":"getSlot"}');
    restore();
    const y = new FakeXhr();
    y.send('{"method":"sendTransaction"}');
    expect(sent).toEqual(['{"method":"getSlot"}', '{"method":"sendTransaction"}']);
  });
});
