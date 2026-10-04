import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cents } from "@nape3/domain";
import { PaymentFlow, settlementUnavailable, type FlowDeps, type PaymentRequest, type PrivateBalance } from "./flow";

const NOW = new Date("2026-10-04T12:00:00Z");
const WALLET = { name: "Phantom", address: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" };
const request: PaymentRequest = { paymentId: "pay-12345678", amountCents: cents(2779), merchant: "Açaí do Bairro", destination: "pix-selected-via-offramp" };
const QUOTE = { offrampNetUsdc: 5_198_149n, grossUsdc: 5_665_144n, simulated: true };
const rejection = Object.assign(new Error("User rejected the request."), { code: 4001 });

function deps(options: { trusted?: boolean; publicUsdc?: bigint; shielded?: bigint; sol?: bigint; connect?: () => Promise<typeof WALLET>; unlock?: () => Promise<PrivateBalance> } = {}) {
  let shielded = options.shielded ?? 0n;
  let publicUsdc = options.publicUsdc ?? 0n;
  const shield = vi.fn(async (amount: bigint) => {
    publicUsdc -= amount;
    shielded += amount;
    return { signature: "SIG", explorer: "https://solscan.io/tx/SIG" };
  });
  const privateBalance: PrivateBalance = { shieldedUsdc: async () => shielded, shield };
  const reports: string[] = [];
  const settle = vi.fn(settlementUnavailable);
  const d: FlowDeps = {
    connectWallet: vi.fn(async ({ silent }) => {
      if (silent && !options.trusted) throw new Error("not trusted");
      return options.connect ? options.connect() : WALLET;
    }),
    unlockPrivateBalance: vi.fn(options.unlock ?? (async () => privateBalance)),
    readPublicBalances: async () => ({ publicUsdc, solLamports: options.sol ?? 50_000_000n }),
    quote: async () => QUOTE,
    settle,
    report: (ctx) => reports.push(ctx.state),
    now: () => NOW
  };
  return { d, shield, reports, settle };
}

describe("UPAY3FOOD Pay flow", () => {
  it("disconnected wallet → WALLET_REQUIRED; Connect starts the wallet connection", async () => {
    const { d, reports } = deps({ shielded: 10_000_000n });
    const flow = new PaymentFlow(d, request);
    await flow.start();
    expect(flow.state.agent.state).toBe("WALLET_REQUIRED");
    expect(reports).toEqual(["WALLET_REQUIRED"]);

    await flow.connect();
    expect(d.connectWallet).toHaveBeenLastCalledWith({ silent: false });
    expect(flow.state.agent.history.map((h) => h.to)).toEqual([
      "PAYMENT_TARGET_DETECTED",
      "WALLET_REQUIRED",
      "WALLET_CONNECTED",
      "FUNDS_CHECKED",
      "PAYMENT_READY"
    ]);
  });

  it("user rejects the connection → stays WALLET_REQUIRED with a friendly notice", async () => {
    const { d } = deps({ connect: async () => { throw rejection; } });
    const flow = new PaymentFlow(d, request);
    await flow.start();
    await flow.connect();
    expect(flow.state.agent.state).toBe("WALLET_REQUIRED");
    expect(flow.state.notice).toEqual({ kind: "info", text: "Connection cancelled. Connect your wallet to pay with crypto." });
  });

  it("user rejects the unlock signature → WALLET_CONNECTED, nothing checked", async () => {
    const { d } = deps({ trusted: true, unlock: async () => { throw rejection; } });
    const flow = new PaymentFlow(d, request);
    await flow.start();
    await flow.checkFunds();
    expect(flow.state.agent.state).toBe("WALLET_CONNECTED");
    expect(flow.state.notice?.text).toContain("Signature cancelled");
  });

  it("insufficient funds → SHIELD_REQUIRED without a shield option", async () => {
    const { d, shield } = deps({ trusted: true, publicUsdc: 2_000_000n });
    const flow = new PaymentFlow(d, request);
    await flow.start();
    await flow.checkFunds();
    expect(flow.state.agent.state).toBe("SHIELD_REQUIRED");
    expect(flow.state.agent.fundingAssessment).toMatchObject({ canShield: false, reason: "insufficient-public-usdc", addPublicUsdc: 4_000_000n });
    await flow.shieldRequired();
    expect(shield).not.toHaveBeenCalled();
  });

  it("public USDC only → Shield required amount → PAYMENT_READY", async () => {
    const { d, shield } = deps({ trusted: true, publicUsdc: 25_000_000n });
    const flow = new PaymentFlow(d, request);
    await flow.start();
    await flow.checkFunds();
    expect(flow.state.agent.state).toBe("SHIELD_REQUIRED");
    expect(flow.state.agent.fundingAssessment).toMatchObject({ canShield: true, shieldAmountUsdc: 6_000_000n });

    await flow.shieldRequired();
    expect(shield).toHaveBeenCalledWith(6_000_000n);
    expect(flow.state.agent.state).toBe("PAYMENT_READY");
    expect(flow.state.agent.funds).toMatchObject({ publicUsdc: 19_000_000n, shieldedUsdc: 6_000_000n });
  });

  it("sufficient shielded funds → confirmation → authorized; settlement stays disabled and spends nothing", async () => {
    const { d, shield, settle, reports } = deps({ trusted: true, shielded: 10_000_000n });
    const flow = new PaymentFlow(d, request);
    await flow.start();
    await flow.checkFunds();
    expect(flow.state.agent.state).toBe("PAYMENT_READY");
    expect(flow.state.agent.fundingRequirement).toEqual({
      checkoutTotalCents: 2779,
      offrampNetUsdc: 5_198_149n,
      cloakFeeUsdc: 466_995n,
      grossUsdc: 5_665_144n,
      destination: "pix-selected-via-offramp",
      quoteSimulated: true
    });

    await flow.confirm();
    expect(flow.state.agent.state).toBe("PAYMENT_AUTHORIZED");
    expect(settle).toHaveBeenCalledOnce();
    expect(flow.state.settlement?.settled).toBe(false);
    expect(flow.state.settlement?.text).toContain("no licensed off-ramp");
    expect(shield).not.toHaveBeenCalled();
    expect(reports.at(-1)).toBe("PAYMENT_AUTHORIZED");
  });

  it("user rejects at confirmation → IDLE, nothing charged", async () => {
    const { d, settle } = deps({ trusted: true, shielded: 10_000_000n });
    const flow = new PaymentFlow(d, request);
    await flow.start();
    await flow.checkFunds();
    flow.reject();
    expect(flow.state.agent.state).toBe("IDLE");
    expect(flow.state.notice?.text).toBe("Payment cancelled. Nothing was charged.");
    expect(settle).not.toHaveBeenCalled();
  });

  it("disconnecting mid-flow returns to WALLET_REQUIRED", async () => {
    const { d } = deps({ trusted: true, shielded: 10_000_000n });
    const flow = new PaymentFlow(d, request);
    await flow.start();
    await flow.checkFunds();
    flow.disconnect();
    expect(flow.state.agent.state).toBe("WALLET_REQUIRED");
  });
});

describe("no keys for normal users", () => {
  it("the Pay page never imports keypair or private-key APIs", () => {
    const sources = readdirSync(__dirname)
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts"))
      .map((f) => readFileSync(join(__dirname, f), "utf8"))
      .join("\n")
      // code only: drop comments
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const forbidden of [/signerFromSecretKey/, /signerFromKeypair/, /KEYPAIR_PATH/, /secretKey/i, /privateKey/, /mnemonic/i, /bip39/i]) {
      expect(sources).not.toMatch(forbidden);
    }
    // No input field may ask for a key or recovery phrase.
    for (const input of sources.match(/<input[^>]*>/g) ?? []) {
      expect(input).not.toMatch(/seed|private|secret|mnemonic|recovery/i);
    }
  });
});
