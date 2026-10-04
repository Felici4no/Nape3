import { describe, expect, it } from "vitest";
import { reduceRun } from "@nape3/agent";
import { cents } from "@nape3/domain";
import { MockOfframp } from "@nape3/payments";
import { ChainSettlement } from "../src/adapters";
import { RuntimeError } from "../src/orchestrator";
import { harness, MARKET, observation, OTHER_WALLET, SIGNATURE, USDC, WALLET } from "./harness";

/**
 * Full orchestration with mocks for the browser executor, the market, RPC Fast
 * (MockSolanaRpcProvider) and the off-ramp (MockOfframp, simulated).
 */

describe("orchestration: intent → order", () => {
  it("cheapest candidate validates and the run reaches ORDER_CONFIRMED", async () => {
    const h = await harness();
    const { id, runToken } = await h.start();
    expect(runToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    let run = await h.run(id);
    expect(run.state).toBe("REVALIDATION_REQUESTED");
    expect(run.selectedCandidate).toMatchObject({ candidateId: "a", observedTotalCents: 1990 });
    expect(await h.orchestrator.commandsFor(h.executorId)).toEqual([run.pendingCommand]);
    expect(run.pendingCommand).toMatchObject({ type: "REVALIDATE_CANDIDATE", candidate: { candidateId: "a", merchantName: "Loja a", quantity: 1 } });

    run = await h.revalidate(id);
    expect(run.state).toBe("QUOTE_VALIDATED");
    expect(run.pendingCommand?.type).toBe("PREPARE_CHECKOUT");
    run = await h.checkout(id);
    expect(run.pendingCommand?.type).toBe("READ_PIX");
    run = await h.pix(id);
    expect(run.state).toBe("WALLET_REQUIRED");

    run = await h.connect(id, 10_000_000n);
    expect(run.state).toBe("USER_CONFIRMATION");
    expect(run.payment.fundsVerified).toBe(true);
    expect(run.payment.confirmationRequest).toMatchObject({ amountCents: 1990, walletAddress: WALLET });

    run = await h.confirmShown(id);
    expect(run.state).toBe("PAYMENT_AUTHORIZED");
    expect(await h.store.getPaymentAttempt(id)).toMatchObject({ status: "authorized", amountCents: 1990, walletAddress: WALLET });

    run = await h.orchestrator.paymentSubmitted(id, { signature: SIGNATURE });
    expect(run.state).toBe("SETTLED");
    expect(run.pendingCommand?.type).toBe("VERIFY_ORDER");
    expect(await h.store.getPaymentAttempt(id)).toMatchObject({ status: "settled", signature: SIGNATURE, settlementReference: `simulated-payout-${id}` });

    run = await h.answer(id, () => ({ type: "ORDER", confirmed: true, evidence: "ifood:order-confirmation" }));
    expect(run.state).toBe("ORDER_CONFIRMED");

    const { events } = await h.orchestrator.load(id);
    expect(reduceRun(events)).toEqual(run);
    expect(h.messages()).toEqual(
      expect.arrayContaining([
        "Searching market…",
        "Found 3 candidates (live market)",
        "Revalidating cheapest option…",
        "Price confirmed in your session: R$19,90",
        "Checkout confirmed at R$19,90",
        "Pix detected: R$19,90",
        "Waiting for wallet…",
        "Ready to pay",
        "You confirmed R$19,90",
        "Settlement verified (simulated off-ramp: no real Pix was paid)",
        "Order confirmed"
      ])
    );
    expect(events.map((e) => e.type)).toEqual([
      "INTENT_CREATED",
      "MARKET_SEARCH_STARTED",
      "MARKET_SEARCHED",
      "CANDIDATE_SELECTED",
      "REVALIDATION_REQUESTED",
      "QUOTE_VALIDATED",
      "CHECKOUT_REQUESTED",
      "CHECKOUT_READY",
      "PIX_REQUESTED",
      "PIX_DETECTED",
      "WALLET_REQUIRED",
      "WALLET_CONNECTED",
      "FUNDS_CHECKED",
      "PAYMENT_READY",
      "CONFIRMATION_REQUESTED",
      "USER_CONFIRMED",
      "PAYMENT_AUTHORIZED",
      "PAYMENT_SUBMITTED",
      "SETTLEMENT_VERIFIED",
      "ORDER_REQUESTED",
      "ORDER_CONFIRMED"
    ]);
  });
});

describe("orchestration: revalidation", () => {
  it("cheapest becomes unavailable → second candidate is selected and revalidated", async () => {
    const h = await harness();
    const { id } = await h.start();
    let run = await h.answer(id, () => ({ type: "UNAVAILABLE", reason: "item sold out" }));
    expect(run.rejectedCandidates).toEqual([{ candidateId: "a", reasons: ["unavailable: item sold out"] }]);
    expect(run.state).toBe("REVALIDATION_REQUESTED");
    expect(run.selectedCandidate?.candidateId).toBe("b");
    run = await h.revalidate(id);
    expect(run.validatedQuote?.quote.source).toBe("rappi");
  });

  it("price changed above the budget → rejected, next candidate tried", async () => {
    const h = await harness();
    const { id } = await h.start();
    const run = await h.revalidate(id, 2690);
    expect(run.rejectedCandidates[0]?.reasons.join(" ")).toMatch(/above the budget of R\$25,00/);
    expect(run.selectedCandidate?.candidateId).toBe("b");
    const quotes = await h.store.listQuotes(id);
    expect(quotes[0]).toMatchObject({ kind: "revalidation", accepted: false, reconciled: true });
  });

  it("a quote that fails reconciliation is blocked (never validated)", async () => {
    const h = await harness();
    const { id } = await h.start();
    let run = await h.run(id);
    const bad = h.quote(run, 1990, "cart", { totalCents: cents(1790) });
    run = await h.answer(id, () => ({ type: "QUOTE", quote: bad, capturedAt: h.nowIso(), pageRef: "ifood:cart" }));
    expect(run.validatedQuote).toBeUndefined();
    expect(run.rejectedCandidates[0]?.reasons.join(" ")).toMatch(/does not reconcile/);
    expect((await h.store.listQuotes(id))[0]).toMatchObject({ reconciled: false, accepted: false });
  });

  it("an unreconciled checkout is blocked too, even after a good revalidation", async () => {
    const h = await harness();
    const { id } = await h.start();
    await h.revalidate(id);
    const run = await h.checkout(id, 1990, { deliveryFeeCents: cents(500) });
    expect(run.checkout).toBeUndefined();
    expect(run.rejectedCandidates[0]?.reasons.join(" ")).toMatch(/does not reconcile/);
  });

  it("stale observations are ignored by the market search", async () => {
    const stale = observation({ id: "stale-cheap", unit: 1200, minutesAgo: 300 });
    const h = await harness({ market: [stale, ...MARKET] });
    const { id } = await h.start();
    const run = await h.run(id);
    expect(run.candidates.map((c) => c.candidateId)).toEqual(["a", "b", "c"]);
  });

  it("no fresh candidate at all → NO_VALID_OPTION without any browser command", async () => {
    const h = await harness({ market: [observation({ id: "old", unit: 1500, minutesAgo: 600 })] });
    const { id } = await h.start();
    expect((await h.run(id)).state).toBe("NO_VALID_OPTION");
    expect(await h.orchestrator.commandsFor(h.executorId)).toEqual([]);
  });

  it("only the run's own executor can answer, and only the pending command", async () => {
    const h = await harness();
    const { id } = await h.start();
    const other = await h.orchestrator.registerExecutor();
    const command = await h.pending(id);
    const run = await h.run(id);
    const result = { type: "QUOTE" as const, commandId: command.commandId, quote: h.quote(run, 1990, "cart"), capturedAt: h.nowIso(), pageRef: "ifood:cart" };
    await expect(h.orchestrator.browserResult(id, other.executorId, result)).rejects.toMatchObject({ status: 403 });
    await expect(h.orchestrator.browserResult(id, h.executorId, { ...result, commandId: "old" })).rejects.toMatchObject({ status: 409 });
    await expect(h.orchestrator.authenticateExecutor(`${h.executorId}.wrong`)).rejects.toBeInstanceOf(RuntimeError);
    expect(await h.orchestrator.authenticateExecutor(h.executorToken)).toBe(h.executorId);
  });

  it("asks the user when the executor needs them, keeping the command pending", async () => {
    const h = await harness();
    const { id } = await h.start();
    const run = await h.answer(id, () => ({ type: "NEEDS_USER", reason: "add Açaí 500ml to the cart at Loja a" }));
    expect(run.state).toBe("REVALIDATION_REQUESTED");
    expect(run.waitingOnUser).toMatch(/add Açaí/);
    expect((await h.orchestrator.status(id)).nextAction).toMatchObject({ kind: "AWAIT_BROWSER", waitingOnUser: expect.stringContaining("add") });
  });
});

describe("orchestration: wallet and funding", () => {
  it("wallet disconnected → WALLET_REQUIRED and the run waits", async () => {
    const h = await harness();
    const { id } = await h.toPix();
    await h.connect(id, 10_000_000n);
    const run = await h.orchestrator.walletState(id, { connected: false });
    expect(run.state).toBe("WALLET_REQUIRED");
    expect(run.payment.confirmationRequest).toBeUndefined();
    expect((await h.orchestrator.status(id)).nextAction).toEqual({ kind: "AWAIT_WALLET" });
  });

  it("insufficient public USDC → SHIELD_REQUIRED that cannot be shielded", async () => {
    const h = await harness({ publicUsdc: 1_000_000n });
    const { id } = await h.toPix();
    const run = await h.connect(id, 0n);
    expect(run.state).toBe("SHIELD_REQUIRED");
    expect(run.payment.assessment).toMatchObject({ kind: "shield-required", canShield: false, reason: "insufficient-public-usdc" });
    expect(h.messages().at(-1)).toMatch(/^Not enough USDC: add/);
  });

  it("shield required → after shielding, funds are re-checked and payment is ready", async () => {
    const h = await harness();
    const { id } = await h.toPix();
    let run = await h.connect(id, 0n);
    expect(run.state).toBe("SHIELD_REQUIRED");
    expect(run.payment.assessment).toMatchObject({ kind: "shield-required", canShield: true, shieldAmountUsdc: 5_000_000n });
    expect(h.messages().at(-1)).toBe("Shield 5,00 USDC to continue");
    h.tick(1);
    run = await h.connect(id, 5_000_000n);
    expect(run.state).toBe("USER_CONFIRMATION");
  });

  it("sufficient shielded funds → straight to the user's confirmation", async () => {
    const h = await harness();
    const { id } = await h.toPix();
    const run = await h.connect(id, 50_000_000n);
    expect(run.state).toBe("USER_CONFIRMATION");
    expect(run.payment.assessment?.kind).toBe("ready");
    expect((await h.orchestrator.status(id)).nextAction).toEqual({ kind: "AWAIT_CONFIRMATION" });
  });

  it("a wallet connected before the Pix is reused once the Pix is known", async () => {
    const h = await harness();
    const { id } = await h.start();
    await h.connect(id, 50_000_000n);
    await h.revalidate(id);
    await h.checkout(id);
    const run = await h.pix(id);
    expect(run.state).toBe("USER_CONFIRMATION");
  });

  it("user rejects the confirmation → CANCELLED, nothing authorized", async () => {
    const h = await harness();
    const { id } = await h.toPix();
    await h.connect(id, 50_000_000n);
    const run = await h.orchestrator.confirm(id, { reject: true, reason: "changed my mind" });
    expect(run.state).toBe("CANCELLED");
    expect(await h.store.getPaymentAttempt(id)).toBeNull();
    await expect(h.orchestrator.paymentSubmitted(id, { signature: SIGNATURE })).rejects.toMatchObject({ status: 409 });
  });

  it("wallet changes mid-run → checkout re-read, funds re-checked, old confirmation refused", async () => {
    const h = await harness();
    const { id } = await h.toPix();
    await h.connect(id, 50_000_000n);
    const oldRequest = (await h.run(id)).payment.confirmationRequest!;

    let run = await h.connect(id, 50_000_000n, OTHER_WALLET);
    expect(run.state).toBe("QUOTE_VALIDATED");
    expect(run.pendingCommand?.type).toBe("READ_CHECKOUT");
    await expect(h.orchestrator.confirm(id, { digest: oldRequest.digest, amountCents: oldRequest.amountCents })).rejects.toMatchObject({ status: 409 });

    await h.checkout(id);
    run = await h.pix(id);
    expect(run.state).toBe("USER_CONFIRMATION");
    expect(run.payment.confirmationRequest?.walletAddress).toBe(OTHER_WALLET);
    expect(run.payment.confirmationRequest?.digest).not.toBe(oldRequest.digest);
  });

  it("a confirmation for a different amount is refused", async () => {
    const h = await harness();
    const { id } = await h.toPix();
    await h.connect(id, 50_000_000n);
    const request = (await h.run(id)).payment.confirmationRequest!;
    await expect(h.orchestrator.confirm(id, { digest: request.digest, amountCents: 1890 })).rejects.toMatchObject({ status: 409 });
  });

  it("a quote that goes stale before confirmation is read again instead of authorized", async () => {
    const h = await harness();
    const { id } = await h.toPix();
    await h.connect(id, 50_000_000n);
    h.tick(11);
    const run = await h.confirmShown(id).catch(() => null);
    expect(run).toBeNull(); // the confirmation request expired with the checkout
    const advanced = await h.orchestrator.advance(id);
    expect(advanced.state).toBe("QUOTE_VALIDATED");
    expect(advanced.pendingCommand?.type).toBe("READ_CHECKOUT");
    expect(await h.store.getPaymentAttempt(id)).toBeNull();
  });
});

const DEPOSIT = "2VH5VUHmCpGXFj66qVLTpBWqFhDxJNWA53oG65i2mn56";

describe("orchestration: settlement", () => {
  it("payment cannot settle → SETTLEMENT_FAILED, recorded on the payment attempt", async () => {
    const h2 = await harness({ settlement: (chain) => new ChainSettlement(chain, USDC, new MockOfframp(), DEPOSIT) });
    h2.chain.addTransaction({ signature: SIGNATURE, slot: 5, blockTime: null, failed: true, error: "InstructionError", signers: [WALLET], preTokenBalances: [], postTokenBalances: [] });
    const { id } = await h2.toPix();
    await h2.connect(id, 50_000_000n);
    await h2.confirmShown(id);
    const run = await h2.orchestrator.paymentSubmitted(id, { signature: SIGNATURE });
    expect(run.state).toBe("SETTLEMENT_FAILED");
    expect(run.payment.settlementFailure).toMatch(/failed on chain/);
    expect(await h2.store.getPaymentAttempt(id)).toMatchObject({ status: "failed", signature: SIGNATURE });
  });

  it("settlement stays SETTLING while the transaction is not confirmed yet", async () => {
    const h2 = await harness({ settlement: (chain) => new ChainSettlement(chain, USDC, new MockOfframp(), DEPOSIT) });
    const { id } = await h2.toPix();
    await h2.connect(id, 50_000_000n);
    await h2.confirmShown(id);
    const run = await h2.orchestrator.paymentSubmitted(id, { signature: SIGNATURE });
    expect(run.state).toBe("SETTLING");
  });

  it("real execution is refused while the off-ramp is simulated", async () => {
    const h = await harness();
    await expect(h.orchestrator.createRun({ request: "quero um açaí 500ml", executorId: h.executorId, executionMode: "real" })).rejects.toMatchObject({ status: 422 });
  });

  it("an unparseable intent creates no run", async () => {
    const h = await harness();
    await expect(h.orchestrator.createRun({ request: "me surpreenda", executorId: h.executorId })).rejects.toMatchObject({ status: 422 });
  });
});

