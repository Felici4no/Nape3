import {
  checkFunds,
  initialContext,
  transition,
  type AgentContext,
  type AgentEvent,
  type FundingRequirement,
  type PaymentDestinationType
} from "@nape3/agent";
import type { Cents } from "@nape3/domain";

/**
 * UPAY3FOOD Pay: one continuous purchase flow driven by the agent state
 * machine. Framework-free so every path is unit-tested; the React view only
 * renders `FlowView` and calls the actions.
 *
 *   PAYMENT_TARGET_DETECTED → WALLET_REQUIRED → WALLET_CONNECTED → FUNDS_CHECKED
 *     → SHIELD_REQUIRED (shield → re-check) | PAYMENT_READY → confirm → PAYMENT_AUTHORIZED
 *
 * Wallet access is only through the injected wallet (Phantom/Solflare):
 * no seed phrase, no private key, no keypair file, ever.
 */

export interface PaymentRequest {
  paymentId: string | null;
  amountCents: Cents;
  merchant: string | null;
  destination: PaymentDestinationType;
}

export interface WalletHandle {
  name: string;
  address: string;
}

/** Shielded side of the wallet, available once the user signed the derivation message. */
export interface PrivateBalance {
  shieldedUsdc(): Promise<bigint>;
  /** Shields `amount` from the public wallet; resolves after notes are persisted. */
  shield(amount: bigint): Promise<{ signature: string; explorer: string }>;
}

export interface FlowDeps {
  /** silent=true must not prompt (wallet's "only if trusted" mode). */
  connectWallet(options: { silent: boolean }): Promise<WalletHandle>;
  /** Prompts the wallet to sign the derivation message (not a transaction). */
  unlockPrivateBalance(wallet: WalletHandle): Promise<PrivateBalance>;
  readPublicBalances(address: string): Promise<{ publicUsdc: bigint; solLamports: bigint }>;
  /** Off-ramp quote (USDC it must receive) and Cloak gross-up. */
  quote(amountCents: Cents): Promise<{ offrampNetUsdc: bigint; grossUsdc: bigint; simulated: boolean }>;
  /** Settlement through a licensed off-ramp. Disabled until one exists. */
  settle(request: PaymentRequest): Promise<{ settled: false; reason: string } | { settled: true; reference: string }>;
  report(context: AgentContext, extra: { shieldedUsdc: bigint | null }): void;
  now(): Date;
}

export type FlowNotice =
  | { kind: "info"; text: string }
  | { kind: "error"; text: string }
  | { kind: "success"; text: string; link?: string };

export interface FlowView {
  agent: AgentContext;
  request: PaymentRequest;
  wallet: WalletHandle | null;
  busy: string | null;
  notice: FlowNotice | null;
  settlement: { settled: boolean; text: string } | null;
}

/** Wallet "user rejected" errors (EIP-1193 style code 4001, or the usual messages). */
export function isUserRejection(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return code === 4001 || /user rejected|rejected the request|declined|cancel/i.test(message);
}

export class PaymentFlow {
  private view: FlowView;
  private privateBalance: PrivateBalance | null = null;
  private shielded: bigint | null = null;
  private listeners = new Set<(view: FlowView) => void>();

  constructor(
    private readonly deps: FlowDeps,
    request: PaymentRequest
  ) {
    const started = transition(
      initialContext(),
      {
        type: "PAY_CURRENT_CHECKOUT",
        checkoutTotalCents: request.amountCents,
        target: { method: "pix", amountCents: request.amountCents, evidence: request.destination === "pix-payload-via-offramp" ? "pix-copy-paste" : "pix-key" }
      },
      deps.now()
    );
    this.view = { agent: started.context, request, wallet: null, busy: null, notice: started.ok ? null : { kind: "error", text: started.error }, settlement: null };
  }

  get state(): FlowView {
    return this.view;
  }

  subscribe(listener: (view: FlowView) => void): () => void {
    this.listeners.add(listener);
    listener(this.view);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<FlowView>) {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener(this.view);
  }

  private apply(event: AgentEvent): boolean {
    const result = transition(this.view.agent, event, this.deps.now());
    if (!result.ok) {
      this.set({ notice: { kind: "error", text: result.error } });
      return false;
    }
    this.set({ agent: result.context });
    this.deps.report(result.context, { shieldedUsdc: this.shielded });
    return true;
  }

  private async busy<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    this.set({ busy: label, notice: null });
    try {
      return await fn();
    } finally {
      this.set({ busy: null });
    }
  }

  /** Called on load: reconnects silently if the wallet already trusts this site. */
  async start(): Promise<void> {
    if (this.view.agent.state !== "PAYMENT_TARGET_DETECTED") return;
    try {
      const wallet = await this.deps.connectWallet({ silent: true });
      this.set({ wallet });
      this.apply({ type: "WALLET_STATUS", connected: true, address: wallet.address });
    } catch {
      this.apply({ type: "WALLET_STATUS", connected: false });
    }
  }

  /** "Connect wallet" (also what the popup's Pay button leads to when disconnected). */
  async connect(): Promise<void> {
    await this.busy("Approve the connection in your wallet…", async () => {
      try {
        const wallet = await this.deps.connectWallet({ silent: false });
        this.set({ wallet });
        this.apply({ type: "WALLET_STATUS", connected: true, address: wallet.address });
      } catch (error) {
        if (this.view.agent.state !== "WALLET_REQUIRED") this.apply({ type: "WALLET_STATUS", connected: false });
        this.set({
          notice: isUserRejection(error)
            ? { kind: "info", text: "Connection cancelled. Connect your wallet to pay with crypto." }
            : { kind: "error", text: `Could not connect the wallet: ${message(error)}` }
        });
      }
    });
    if (this.view.agent.state === "WALLET_CONNECTED") await this.checkFunds();
  }

  disconnect(): void {
    this.privateBalance = null;
    this.shielded = null;
    this.set({ wallet: null });
    this.apply({ type: "WALLET_STATUS", connected: false });
  }

  /** Reads public balances and, after one signature, the shielded balance. */
  async checkFunds(): Promise<void> {
    const wallet = this.view.wallet;
    if (!wallet) return;
    await this.busy("Checking your balances…", async () => {
      try {
        if (!this.privateBalance) {
          this.set({ busy: "Sign once in your wallet to read your private balance (not a transaction)…" });
          this.privateBalance = await this.deps.unlockPrivateBalance(wallet);
        }
        const [publicBalances, shielded, quote] = await Promise.all([
          this.deps.readPublicBalances(wallet.address),
          this.privateBalance.shieldedUsdc(),
          this.deps.quote(this.view.request.amountCents)
        ]);
        this.shielded = shielded;
        const requirement: FundingRequirement = {
          checkoutTotalCents: this.view.request.amountCents,
          offrampNetUsdc: quote.offrampNetUsdc,
          cloakFeeUsdc: quote.grossUsdc - quote.offrampNetUsdc,
          grossUsdc: quote.grossUsdc,
          destination: this.view.request.destination,
          quoteSimulated: quote.simulated
        };
        const result = checkFunds(
          this.view.agent,
          { address: wallet.address, publicUsdc: publicBalances.publicUsdc, shieldedUsdc: shielded, solLamports: publicBalances.solLamports, checkedAt: this.deps.now().toISOString() },
          requirement,
          this.deps.now()
        );
        if (!result.ok) {
          this.set({ notice: { kind: "error", text: result.error } });
          return;
        }
        this.set({ agent: result.context });
        this.deps.report(result.context, { shieldedUsdc: shielded });
      } catch (error) {
        this.set({
          notice: isUserRejection(error)
            ? { kind: "info", text: "Signature cancelled. It is needed once to read your private (shielded) balance." }
            : { kind: "error", text: `Could not check balances: ${message(error)}` }
        });
      }
    });
  }

  /** "Shield required amount": public wallet → Cloak pool, then re-check. */
  async shieldRequired(): Promise<void> {
    const assessment = this.view.agent.fundingAssessment;
    if (this.view.agent.state !== "SHIELD_REQUIRED" || assessment?.kind !== "shield-required" || !assessment.canShield) return;
    const ok = await this.busy("Approve the shield in your wallet; then the proof is generated (up to a minute)…", async () => {
      try {
        const result = await this.privateBalance!.shield(assessment.shieldAmountUsdc);
        this.set({ notice: { kind: "success", text: "Shielded. Your private balance is updated.", link: result.explorer } });
        return true;
      } catch (error) {
        this.set({
          notice: isUserRejection(error)
            ? { kind: "info", text: "Shield cancelled. Nothing left your wallet." }
            : { kind: "error", text: `Shield failed: ${message(error)}` }
        });
        return false;
      }
    });
    if (ok) await this.checkFunds();
  }

  /** Confirmation → PAYMENT_AUTHORIZED; settlement stays disabled without a licensed off-ramp. */
  async confirm(): Promise<void> {
    if (this.view.agent.state !== "PAYMENT_READY") return;
    const authorized = this.apply({
      type: "AUTHORIZE_PAYMENT",
      authorization: { confirmedByUser: true, amountCents: this.view.request.amountCents, at: this.deps.now().toISOString() }
    });
    if (!authorized) return;
    const outcome = await this.deps.settle(this.view.request);
    if (outcome.settled) {
      this.apply({ type: "SETTLED", reference: outcome.reference });
      this.set({ settlement: { settled: true, text: `Paid. Reference ${outcome.reference}` } });
    } else {
      this.set({ settlement: { settled: false, text: outcome.reason } });
    }
  }

  /** "Cancel" on the confirmation: nothing is charged. */
  reject(): void {
    this.apply({ type: "USER_REJECTED" });
    this.set({ notice: { kind: "info", text: "Payment cancelled. Nothing was charged." } });
  }
}

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/[0-9a-f]{64,}/gi, "[hex]").slice(0, 200);
}

/** Settlement until a licensed off-ramp is integrated: never moves funds. */
export async function settlementUnavailable(): Promise<{ settled: false; reason: string }> {
  return {
    settled: false,
    reason:
      "Authorized, but settlement is disabled: no licensed off-ramp is integrated yet. " +
      "Your shielded funds were not spent and nothing was charged. Pay this order with Pix as usual."
  };
}

