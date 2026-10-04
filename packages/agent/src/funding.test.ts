import { describe, expect, it } from "vitest";
import { cents } from "@nape3/domain";
import { assessFunding, type FundingRequirement, type WalletFunds } from "./funding";
import { checkFunds, initialContext, run, transition, type AgentContext } from "./state-machine";

const NOW = new Date("2026-10-04T12:00:00Z");
const requirement: FundingRequirement = {
  checkoutTotalCents: cents(2779),
  offrampNetUsdc: 5_198_149n,
  cloakFeeUsdc: 466_995n,
  grossUsdc: 5_665_144n,
  destination: "pix-payload-via-offramp",
  quoteSimulated: true
};
const funds = (over: Partial<WalletFunds> = {}): WalletFunds => ({
  address: "Wallet1111",
  publicUsdc: 0n,
  shieldedUsdc: 0n,
  solLamports: 50_000_000n,
  checkedAt: NOW.toISOString(),
  ...over
});

/** User pressed "Pay R$27,79 with crypto" on a validated checkout with Pix detected. */
function startPayment(): AgentContext {
  const result = transition(
    initialContext(),
    { type: "PAY_CURRENT_CHECKOUT", checkoutTotalCents: cents(2779), target: { method: "pix", amountCents: cents(2779), evidence: "pix-copy-paste" } },
    NOW
  );
  if (!result.ok) throw new Error(result.error);
  return result.context;
}

function connected(): AgentContext {
  const result = transition(startPayment(), { type: "WALLET_STATUS", connected: true, address: "Wallet1111" }, NOW);
  if (!result.ok) throw new Error(result.error);
  return result.context;
}

describe("crypto payment states", () => {
  it("disconnected wallet → WALLET_REQUIRED, and nothing can be checked or authorized", () => {
    const ctx = run([{ type: "WALLET_STATUS", connected: false }], startPayment(), NOW).context;
    expect(ctx.state).toBe("WALLET_REQUIRED");
    expect(transition(ctx, { type: "FUNDS_CHECKED", funds: funds({ shieldedUsdc: 10_000_000n }), requirement }).ok).toBe(false);
    expect(
      transition(ctx, { type: "AUTHORIZE_PAYMENT", authorization: { confirmedByUser: true, amountCents: cents(2779), at: "" } }).ok
    ).toBe(false);
  });

  it("connecting moves to WALLET_CONNECTED; disconnecting later returns to WALLET_REQUIRED", () => {
    const ctx = connected();
    expect(ctx.state).toBe("WALLET_CONNECTED");
    expect(ctx.walletAddress).toBe("Wallet1111");
    const ready = checkFunds(ctx, funds({ shieldedUsdc: 10_000_000n }), requirement, NOW).context;
    const dropped = transition(ready, { type: "WALLET_STATUS", connected: false }, NOW);
    expect(dropped.context.state).toBe("WALLET_REQUIRED");
    expect(dropped.context.funds).toBeUndefined();
  });

  it("insufficient funds everywhere → SHIELD_REQUIRED, cannot shield, says how much USDC to add", () => {
    const result = checkFunds(connected(), funds({ publicUsdc: 2_000_000n }), requirement, NOW);
    expect(result.context.history.map((h) => h.to).slice(-2)).toEqual(["FUNDS_CHECKED", "SHIELD_REQUIRED"]);
    expect(result.context.fundingAssessment).toEqual({
      kind: "shield-required",
      missingUsdc: 5_665_144n,
      shieldAmountUsdc: 6_000_000n,
      canShield: false,
      reason: "insufficient-public-usdc",
      addPublicUsdc: 4_000_000n
    });
  });

  it("public USDC only → SHIELD_REQUIRED with a whole-USDC shield amount", () => {
    const result = checkFunds(connected(), funds({ publicUsdc: 25_000_000n }), requirement, NOW);
    expect(result.context.state).toBe("SHIELD_REQUIRED");
    expect(result.context.fundingAssessment).toEqual({
      kind: "shield-required",
      missingUsdc: 5_665_144n,
      shieldAmountUsdc: 6_000_000n,
      canShield: true
    });
  });

  it("public USDC but no SOL for fees → cannot shield yet", () => {
    const result = checkFunds(connected(), funds({ publicUsdc: 25_000_000n, solLamports: 0n }), requirement, NOW);
    expect(result.context.fundingAssessment).toMatchObject({ canShield: false, reason: "insufficient-sol" });
  });

  it("after shielding, a new check reaches PAYMENT_READY", () => {
    const needShield = checkFunds(connected(), funds({ publicUsdc: 25_000_000n }), requirement, NOW).context;
    const afterShield = checkFunds(needShield, funds({ publicUsdc: 19_000_000n, shieldedUsdc: 6_000_000n }), requirement, NOW);
    expect(afterShield.context.state).toBe("PAYMENT_READY");
  });

  it("sufficient shielded funds → PAYMENT_READY → authorized", () => {
    const ready = checkFunds(connected(), funds({ shieldedUsdc: 5_665_144n }), requirement, NOW).context;
    expect(ready.state).toBe("PAYMENT_READY");
    expect(ready.fundingAssessment).toEqual({ kind: "ready", spareShieldedUsdc: 0n });
    const authorized = transition(
      ready,
      { type: "AUTHORIZE_PAYMENT", authorization: { confirmedByUser: true, amountCents: cents(2779), at: NOW.toISOString() } },
      NOW
    );
    expect(authorized.context.state).toBe("PAYMENT_AUTHORIZED");
  });

  it("user rejection at confirmation → IDLE, nothing authorized", () => {
    const ready = checkFunds(connected(), funds({ shieldedUsdc: 10_000_000n }), requirement, NOW).context;
    const rejected = transition(ready, { type: "USER_REJECTED" }, NOW);
    expect(rejected.context.state).toBe("IDLE");
    expect(rejected.context.authorization).toBeUndefined();
    expect(rejected.context.warnings).toContain("user rejected the payment; nothing was charged");
  });

  it("refuses balances of another wallet and mismatched Pix amounts", () => {
    expect(checkFunds(connected(), funds({ address: "Other" }), requirement, NOW).ok).toBe(false);
    const mismatch = transition(initialContext(), {
      type: "PAY_CURRENT_CHECKOUT",
      checkoutTotalCents: cents(2779),
      target: { method: "pix", amountCents: cents(2879), evidence: "pix-copy-paste" }
    });
    expect(mismatch.ok).toBe(false);
  });

  it("assessFunding: shield amount is at least the Cloak minimum", () => {
    const small = { ...requirement, grossUsdc: 1_000_100n };
    const result = assessFunding(small, funds({ shieldedUsdc: 1_000_000n, publicUsdc: 5_000_000n }));
    expect(result).toMatchObject({ kind: "shield-required", missingUsdc: 100n, shieldAmountUsdc: 1_000_000n, canShield: true });
  });
});
