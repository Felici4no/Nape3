import { describe, expect, it } from "vitest";
import { cents } from "@nape3/domain";
import { acaiFixtures, FIXTURE_NOW } from "@nape3/fixtures";
import { planPurchase } from "./plan";
import { checkFunds, run, transition, type PaymentTarget } from "./state-machine";

const plan = planPurchase("quero um açaí 500ml até 25 reais", acaiFixtures(), {
  now: FIXTURE_NOW,
  policy: { provenance: "include-synthetic" }
});

const target: PaymentTarget = { method: "pix", amountCents: cents(1690), evidence: "pix-copy-paste" };

describe("agent state machine", () => {
  it("plans up to USER_CONFIRMATION and stops", () => {
    expect(plan.agent.state).toBe("USER_CONFIRMATION");
    expect(plan.agent.history.map((h) => h.to)).toEqual([
      "INTENT_CAPTURED",
      "MARKET_SEARCH",
      "CANDIDATES_NORMALIZED",
      "CONSTRAINTS_APPLIED",
      "BEST_OPTION_SELECTED",
      "USER_CONFIRMATION"
    ]);
  });

  it("cannot prepare checkout without explicit confirmation", () => {
    const result = transition(plan.agent, { type: "CHECKOUT_PREPARED", checkoutTotalCents: cents(1690) });
    expect(result.ok).toBe(false);
  });

  const funds = (shielded: bigint, publicUsdc = 0n, sol = 50_000_000n) => ({
    address: "Wallet1111",
    publicUsdc,
    shieldedUsdc: shielded,
    solLamports: sol,
    checkedAt: FIXTURE_NOW.toISOString()
  });
  const requirementFor = (amountCents: number) => ({
    checkoutTotalCents: cents(amountCents),
    offrampNetUsdc: 3_143_000n,
    cloakFeeUsdc: 459_430n,
    grossUsdc: 3_602_430n,
    destination: "pix-payload-via-offramp" as const,
    quoteSimulated: true
  });

  function readyContext(paymentTarget = target) {
    const atTarget = run(
      [
        { type: "USER_CONFIRMED", at: FIXTURE_NOW.toISOString() },
        { type: "CHECKOUT_PREPARED", checkoutTotalCents: cents(1690) },
        { type: "PAYMENT_TARGET_DETECTED", target: paymentTarget },
        { type: "WALLET_STATUS", connected: true, address: "Wallet1111" }
      ],
      plan.agent,
      FIXTURE_NOW
    );
    return checkFunds(atTarget.context, funds(10_000_000n), requirementFor(paymentTarget.amountCents), FIXTURE_NOW);
  }

  it("cannot authorize straight from a detected Pix target (wallet and funds first)", () => {
    const atTarget = run(
      [
        { type: "USER_CONFIRMED", at: FIXTURE_NOW.toISOString() },
        { type: "CHECKOUT_PREPARED", checkoutTotalCents: cents(1690) },
        { type: "PAYMENT_TARGET_DETECTED", target }
      ],
      plan.agent,
      FIXTURE_NOW
    );
    const direct = transition(atTarget.context, {
      type: "AUTHORIZE_PAYMENT",
      authorization: { confirmedByUser: true, amountCents: cents(1690), at: FIXTURE_NOW.toISOString() }
    });
    expect(direct.ok).toBe(false);
  });

  it("reaches PAYMENT_AUTHORIZED only with matching explicit authorization", () => {
    const ready = readyContext();
    expect(ready.context.state).toBe("PAYMENT_READY");

    const wrongAmount = transition(ready.context, {
      type: "AUTHORIZE_PAYMENT",
      authorization: { confirmedByUser: true, amountCents: cents(1700), at: FIXTURE_NOW.toISOString() }
    });
    expect(wrongAmount.ok).toBe(false);

    const forged = transition(ready.context, {
      type: "AUTHORIZE_PAYMENT",
      authorization: { confirmedByUser: false, amountCents: cents(1690), at: "" } as never
    });
    expect(forged.ok).toBe(false);

    const authorized = transition(ready.context, {
      type: "AUTHORIZE_PAYMENT",
      authorization: { confirmedByUser: true, amountCents: cents(1690), at: FIXTURE_NOW.toISOString() }
    });
    expect(authorized.ok && authorized.context.state).toBe("PAYMENT_AUTHORIZED");
    const settled = transition(authorized.context, { type: "SETTLED", reference: "mock-1" });
    expect(settled.context.state).toBe("SETTLED");
  });

  it("rejects expired payment targets", () => {
    const ready = readyContext({ ...target, expiresAt: "2026-10-04T11:00:00Z" });
    const auth = transition(
      ready.context,
      { type: "AUTHORIZE_PAYMENT", authorization: { confirmedByUser: true, amountCents: cents(1690), at: "" } },
      FIXTURE_NOW
    );
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.error).toContain("expired");
  });

  it("warns when the Pix amount differs from the checkout total", () => {
    const res = run(
      [
        { type: "USER_CONFIRMED", at: FIXTURE_NOW.toISOString() },
        { type: "CHECKOUT_PREPARED", checkoutTotalCents: cents(1690) },
        { type: "PAYMENT_TARGET_DETECTED", target: { ...target, amountCents: cents(1790) } }
      ],
      plan.agent,
      FIXTURE_NOW
    );
    expect(res.context.warnings.join()).toContain("differs from checkout total");
  });

  it("routes to NO_VALID_OPTION and rejects invalid jumps", () => {
    const none = planPurchase("açaí 500ml até 5 reais", acaiFixtures(), {
      now: FIXTURE_NOW,
      policy: { provenance: "include-synthetic" }
    });
    expect(none.agent.state).toBe("NO_VALID_OPTION");
    expect(transition(none.agent, { type: "CONFIRMATION_REQUESTED" }).ok).toBe(false);
    expect(transition(none.agent, { type: "RESET" }).context.state).toBe("IDLE");
  });

  it("goes to ERROR on unsupported intent", () => {
    const bad = planPurchase("quero um churrasco", [], { now: FIXTURE_NOW });
    expect(bad.agent.state).toBe("ERROR");
  });
});
