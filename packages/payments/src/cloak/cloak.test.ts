import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { address, generateKeyPairSigner, type CloakRpc } from "@cloak.dev/sdk";
import { cents } from "@nape3/domain";
import { buildStaticPixBrCode } from "../pix";
import { MockOfframp } from "../offramp";
import { PaymentRouter } from "../router";
import { MockWallet, USDC_MINT } from "../solana";
import {
  CloakFunding,
  CloakKeys,
  CloakPersistenceError,
  cloakFundingSource,
  cloakOptions,
  cloakWithdrawFee,
  createCloakLogger,
  createSimulatedCloakSdk,
  fromBase64,
  grossUpWithdrawal,
  InsufficientShieldedBalanceError,
  MemoryNoteStore,
  netAfterWithdrawFee,
  parseUsdc,
  PRIVACY_COPY,
  seedFromWalletSignature,
  type NoteStore,
  type StoredNote
} from "./index";

const USDC = address(USDC_MINT["mainnet-beta"]);
const SEED = new Uint8Array(32).fill(7);

async function setup(store: NoteStore = new MemoryNoteStore()) {
  const lines: string[] = [];
  const { sdk, submitted } = createSimulatedCloakSdk();
  const keys = await CloakKeys.fromSeed(SEED);
  const keypair = await generateKeyPairSigner();
  const funding = new CloakFunding({
    sdk,
    connection: {} as CloakRpc,
    signer: { kind: "keypair", keypair },
    keys,
    store,
    mint: USDC,
    log: createCloakLogger((line) => lines.push(line))
  });
  return { funding, lines, submitted, keys, store, keypair };
}

describe("USDC units (bigint)", () => {
  it("parses USDC without floats", () => {
    expect(parseUsdc("1")).toBe(1_000_000n);
    expect(parseUsdc("5,10")).toBe(5_100_000n);
    expect(parseUsdc("0.000001")).toBe(1n);
    expect(() => parseUsdc("1.0000001")).toThrow();
  });

  it("matches the SDK fee formula: 0.45 USDC + 0.3%", () => {
    expect(cloakWithdrawFee(10_000_000n)).toBe(450_000n + 30_000n);
  });

  it("grosses up to the minimal withdrawal that nets the target", () => {
    for (const net of [1n, 999_999n, 5_220_000n, 123_456_789n]) {
      const gross = grossUpWithdrawal(net);
      expect(netAfterWithdrawFee(gross)).toBeGreaterThanOrEqual(net);
      expect(netAfterWithdrawFee(gross - 1n)).toBeLessThan(net);
    }
  });
});

describe("Cloak keys", () => {
  it("derives the same keys from the same wallet signature", async () => {
    const sig = new Uint8Array(64).fill(9);
    const a = await CloakKeys.fromSeed(await seedFromWalletSignature(sig));
    const b = await CloakKeys.fromSeed(await seedFromWalletSignature(sig));
    expect(a.viewingPublicKeyHex).toBe(b.viewingPublicKeyHex);
    expect(a.utxoKeypair().publicKey).toBe(b.utxoKeypair().publicKey);
  });

  it("never reveals secrets when logged or serialized", async () => {
    const keys = await CloakKeys.fromSeed(SEED);
    const nkHex = Buffer.from(keys.viewingKeyNk()).toString("hex");
    for (const rendered of [JSON.stringify({ keys }), `${keys}`, inspect(keys), inspect({ nested: { keys } })]) {
      expect(rendered).not.toContain(nkHex);
      expect(rendered).toMatch(/redacted/);
    }
  });

  it("keeps viewing-key registration (compliance) on in mainnet options", async () => {
    const keys = await CloakKeys.fromSeed(SEED);
    const options = cloakOptions({} as CloakRpc, { kind: "keypair", keypair: await generateKeyPairSigner() }, keys.viewingKeyNk());
    expect(options.enforceViewingKeyRegistration).toBeUndefined();
    expect(options.relayUrl).toBe("https://api.cloak.ag");
  });
});

describe("CloakFunding: shield", () => {
  it("rejects deposits below the 1.00 USDC minimum", async () => {
    const { funding } = await setup();
    await expect(funding.shield(999_999n)).rejects.toThrow(/at least/);
  });

  it("persists the output note (with index) before resolving", async () => {
    const { funding, store } = await setup();
    const result = await funding.shield(10_000_000n);
    const notes = await store.load();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ amount: "10000000", status: "unspent", createdBy: result.signature, index: 1000 });
    expect(result.balance).toMatchObject({ total: 10_000_000n, notes: 1 });
    expect(result.signature).toMatch(/^SIMULATED/);
  });

  it("does not report success if the notes cannot be persisted", async () => {
    const failing: NoteStore = { load: async () => [], save: async () => { throw new Error("disk full"); } };
    const { funding, lines } = await setup(failing);
    const error = await funding.shield(2_000_000n).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloakPersistenceError);
    expect((error as CloakPersistenceError).signature).toMatch(/^SIMULATED/);
    expect(lines.some((l) => l.includes("shield.done"))).toBe(false);
  });

  it("detects a store that silently drops writes (read-back check)", async () => {
    const lossy: NoteStore = { load: async () => [], save: async () => {} };
    const { funding } = await setup(lossy);
    await expect(funding.shield(2_000_000n)).rejects.toBeInstanceOf(CloakPersistenceError);
  });

  it("a wallet-signed shield never retries by itself; a keypair keeps the SDK default", async () => {
    const seen: Array<{ maxRootRetries?: number; hasProgress: boolean }> = [];
    const { sdk } = createSimulatedCloakSdk();
    const spy: typeof sdk = {
      ...sdk,
      transact: (params, options) => {
        seen.push({ ...(options.maxRootRetries !== undefined ? { maxRootRetries: options.maxRootRetries } : {}), hasProgress: typeof options.onProgress === "function" });
        return sdk.transact(params, options);
      }
    };
    const keys = await CloakKeys.fromSeed(SEED);
    const keypair = await generateKeyPairSigner();
    const base = { sdk: spy, connection: {} as CloakRpc, keys, store: new MemoryNoteStore(), mint: USDC, log: createCloakLogger(() => {}) };

    await new CloakFunding({ ...base, signer: { kind: "keypair", keypair } }).shield(1_000_000n);
    await new CloakFunding({
      ...base,
      store: new MemoryNoteStore(),
      signer: { kind: "wallet", signer: keypair, signMessage: async () => new Uint8Array(64), address: keypair.address }
    }).shield(1_000_000n, { onProgress: () => {} });

    expect(seen).toEqual([{ hasProgress: false }, { maxRootRetries: 0, hasProgress: true }]);
  });

  it("relaySupplementalAlt reaches the SDK only when asked, together with maxRootRetries 0 and v0", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { sdk } = createSimulatedCloakSdk();
    const spy: typeof sdk = {
      ...sdk,
      transact: (params, options) => {
        seen.push({ relaySupplementalAlt: options.relaySupplementalAlt, maxRootRetries: options.maxRootRetries, transactionVersion: options.transactionVersion });
        return sdk.transact(params, options);
      }
    };
    const keys = await CloakKeys.fromSeed(SEED);
    const keypair = await generateKeyPairSigner();
    const wallet = { kind: "wallet" as const, signer: keypair, signMessage: async () => new Uint8Array(64), address: keypair.address };
    const base = { sdk: spy, connection: {} as CloakRpc, keys, mint: USDC, log: createCloakLogger(() => {}), signer: wallet };
    await new CloakFunding({ ...base, store: new MemoryNoteStore() }).shield(1_000_000n, { relaySupplementalAlt: true });
    await new CloakFunding({ ...base, store: new MemoryNoteStore() }).shield(1_000_000n);
    expect(seen).toEqual([
      { relaySupplementalAlt: true, maxRootRetries: 0, transactionVersion: undefined },
      { relaySupplementalAlt: undefined, maxRootRetries: 0, transactionVersion: undefined }
    ]);
  });
});

describe("CloakFunding: fund a purchase privately", () => {
  it("withdraws the grossed-up amount, persists change and marks inputs spent", async () => {
    const { funding, store, submitted } = await setup();
    await funding.shield(10_000_000n);
    const offramp = address("11111111111111111111111111111112");
    const net = 5_220_000n; // ≈ R$27,79 at the mock rate
    const result = await funding.fundPayment(offramp, net);

    const gross = grossUpWithdrawal(net);
    expect(result).toMatchObject({ gross, net, fee: cloakWithdrawFee(gross), change: 10_000_000n - gross });
    expect(submitted.at(-1)).toEqual({ kind: "withdraw", externalAmount: -gross, recipient: offramp });

    const notes = await store.load();
    expect(notes.find((n) => n.amount === "10000000")).toMatchObject({ status: "spent", spentBy: result.signature });
    const change = notes.find((n) => n.status === "unspent")!;
    expect(BigInt(change.amount)).toBe(10_000_000n - gross);
    expect(change.siblingCommitment).toBeDefined();
    expect(result.balance.total).toBe(10_000_000n - gross);
  });

  it("can spend the persisted change note afterwards (round-trip through storage)", async () => {
    const { funding } = await setup();
    await funding.shield(10_000_000n);
    const offramp = address("11111111111111111111111111111112");
    await funding.fundPayment(offramp, 1_000_000n);
    const second = await funding.fundPayment(offramp, 1_000_000n);
    expect(second.balance.notes).toBe(1);
  });

  it("refuses when the shielded balance is insufficient", async () => {
    const { funding } = await setup();
    await funding.shield(1_000_000n);
    await expect(funding.fundPayment(address("11111111111111111111111111111112"), 1_000_000n)).rejects.toBeInstanceOf(
      InsufficientShieldedBalanceError
    );
  });

  it("releases notes if submission fails", async () => {
    const { funding, store } = await setup();
    await funding.shield(10_000_000n);
    const broken = new CloakFunding({
      ...(funding as unknown as { deps: ConstructorParameters<typeof CloakFunding>[0] }).deps,
      sdk: {
        ...(funding as unknown as { deps: ConstructorParameters<typeof CloakFunding>[0] }).deps.sdk,
        partialWithdraw: async () => {
          throw new Error("relay down");
        }
      }
    });
    await expect(broken.fundPayment(address("11111111111111111111111111111112"), 1_000_000n)).rejects.toThrow("relay down");
    expect((await store.load()).every((n: StoredNote) => n.status === "unspent")).toBe(true);
  });

  it("reconciles with chain nullifiers", async () => {
    const { funding } = await setup();
    await funding.shield(3_000_000n);
    expect((await funding.reconcileWithChain()).total).toBe(3_000_000n);
  });

  it("never logs keys, notes or payloads", async () => {
    const { funding, lines, store, keys } = await setup();
    await funding.shield(10_000_000n);
    await funding.fundPayment(address("11111111111111111111111111111112"), 2_000_000n);
    const log = lines.join("\n");
    const secrets = [
      Buffer.from(keys.viewingKeyNk()).toString("hex"),
      Buffer.from(keys.spendKey()).toString("hex"),
      keys.utxoKeypair().privateKey.toString(),
      ...(await store.load()).flatMap((n) => [n.serialized, Buffer.from(fromBase64(n.serialized)).toString("hex")])
    ];
    for (const secret of secrets) expect(log).not.toContain(secret);
    expect(log).toContain("fund.done");
  });
});

describe("router with Cloak funding", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const pix = buildStaticPixBrCode({ pixKey: "loja@example.com", merchantName: "ACAI TESTE", merchantCity: "SAO PAULO", amountCents: cents(2779) });

  it("plans with the shielded balance, Cloak fee and privacy statement", async () => {
    const { funding } = await setup();
    await funding.shield(20_000_000n);
    const router = new PaymentRouter(new MockWallet(0n), new MockOfframp(), "mainnet-beta", cloakFundingSource(funding, { simulated: true }));
    const plan = await router.plan(pix, now);
    expect(plan.blockers).toEqual([]);
    expect(plan.funding.kind).toBe("cloak-shielded");
    expect(plan.funding.costUsdc).toBe(grossUpWithdrawal(plan.quote.usdcRequired) - plan.quote.usdcRequired);
    expect(plan.funding.privacyNote).toContain(PRIVACY_COPY.headline);
    expect(plan.funding.privacyNote).toContain("Pix is not private");
    expect(plan.steps.join("\n")).toContain("not from your wallet");

    const payout = await router.execute(plan, { confirmedByUser: true, amountCents: cents(2779), at: now.toISOString() }, now);
    expect(payout.simulated).toBe(true);
  });

  it("blocks real Cloak funding from paying a simulated off-ramp", async () => {
    const { funding } = await setup();
    await funding.shield(20_000_000n);
    const router = new PaymentRouter(new MockWallet(0n), new MockOfframp(), "mainnet-beta", cloakFundingSource(funding, { simulated: false }));
    const plan = await router.plan(pix, now);
    expect(plan.blockers.join()).toContain("real funding cannot pay a simulated off-ramp");
  });

  it("keeps the public-wallet path as the default", async () => {
    const router = new PaymentRouter(new MockWallet(100_000_000n), new MockOfframp(), "mainnet-beta");
    const plan = await router.plan(pix, now);
    expect(plan.funding).toEqual({ kind: "public-wallet", costUsdc: 0n, privacyNote: null });
  });
});
