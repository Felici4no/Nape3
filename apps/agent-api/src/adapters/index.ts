import type { AgentRun, PixTarget } from "@nape3/agent";
import type { FundingRequirement } from "@nape3/agent";
import { isSolanaSignature, verifyTokenTransfer, type SolanaRpcProvider } from "@nape3/chain";
import { cents, type Cents, type MarketObservation } from "@nape3/domain";
import { marketFixtures } from "@nape3/fixtures";
import { sanitizeObservation } from "@nape3/market";
import { MockOfframp, type OfframpProvider } from "@nape3/payments";
import { cloakWithdrawFee, grossUpWithdrawal } from "@nape3/payments/cloak";
import type { FundingPort, MarketPort, MarketSearch, SettlementCheck, SettlementPort } from "../ports";

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

/** Live market from apps/observer-api: real observations only, re-sanitized, synthetic dropped. */
export class ObserverMarket implements MarketPort {
  constructor(
    private readonly baseUrl: string,
    private readonly readToken?: string,
    private readonly marketRegion = "BR-SP-sao-paulo"
  ) {}

  async search(): Promise<MarketSearch> {
    const url = new URL("/v1/observations", this.baseUrl);
    url.searchParams.set("sinceMinutes", "180");
    url.searchParams.set("provenance", "real");
    const response = await fetch(url, {
      headers: this.readToken ? { authorization: `Bearer ${this.readToken}` } : {},
      signal: AbortSignal.timeout(5_000)
    });
    if (!response.ok) throw new Error(`observer API answered ${response.status}`);
    const body = (await response.json()) as { observations?: unknown[] };
    const observations: MarketObservation[] = [];
    for (const item of body.observations ?? []) {
      const r = sanitizeObservation(item);
      if (r.ok && !r.observation.provenance.synthetic) observations.push(r.observation);
    }
    return { observations, mode: "live", marketRegion: this.marketRegion };
  }
}

/** Synthetic demo market (fixtures). Labelled "demo" end to end. */
export class DemoMarket implements MarketPort {
  async search(now: Date): Promise<MarketSearch> {
    return { observations: marketFixtures(now), mode: "demo", marketRegion: "BR-SP-sao-paulo" };
  }
}

/** Fixed observations (tests). */
export class StaticMarket implements MarketPort {
  constructor(
    private readonly observations: MarketObservation[] | (() => MarketObservation[]),
    private readonly mode: "live" | "demo" = "live"
  ) {}
  async search(): Promise<MarketSearch> {
    return { observations: typeof this.observations === "function" ? this.observations() : this.observations, mode: this.mode, marketRegion: "BR-SP-sao-paulo" };
  }
}

// ---------------------------------------------------------------------------
// Funding (off-ramp quote + Cloak fee); the agent never touches Cloak itself
// ---------------------------------------------------------------------------

export class OfframpFunding implements FundingPort {
  readonly simulated: boolean;
  constructor(private readonly offramp: OfframpProvider = new MockOfframp()) {
    this.simulated = offramp.simulated;
  }

  async requirement(amountCents: Cents, pix: PixTarget, now: Date): Promise<FundingRequirement> {
    const quote = await this.offramp.quote(cents(amountCents), now);
    const grossUsdc = grossUpWithdrawal(quote.usdcRequired);
    return {
      checkoutTotalCents: amountCents,
      offrampNetUsdc: quote.usdcRequired,
      cloakFeeUsdc: cloakWithdrawFee(grossUsdc),
      grossUsdc,
      destination: pix.evidence === "pix-selected" ? "pix-selected-via-offramp" : "pix-payload-via-offramp",
      quoteSimulated: this.offramp.simulated
    };
  }

  depositAddress(now: Date): Promise<string> {
    return this.offramp.quote(cents(100), now).then((q) => q.depositAddress);
  }
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

/**
 * Simulated settlement: accepts a well-formed signature for simulated runs
 * and reports `simulated: true`. Refuses real runs: no money is ever
 * "settled" by a mock.
 */
export class SimulatedSettlement implements SettlementPort {
  async verify(run: AgentRun, signature: string): Promise<SettlementCheck> {
    if (run.executionMode !== "simulated") return { status: "failed", reason: "simulated settlement cannot settle a real run" };
    if (!isSolanaSignature(signature)) return { status: "failed", reason: "not a Solana transaction signature" };
    return { status: "settled", reference: `simulated-payout-${run.id}`, simulated: true };
  }
}

/**
 * Real settlement path: the private withdrawal must have reached the
 * off-ramp's deposit address on chain (read via RPC Fast), then the off-ramp
 * must report the Pix payout. Requires a licensed, non-simulated off-ramp.
 */
export class ChainSettlement implements SettlementPort {
  constructor(
    private readonly provider: SolanaRpcProvider,
    private readonly usdcMint: string,
    private readonly offramp: OfframpProvider,
    private readonly depositAddress: string
  ) {}

  async verify(run: AgentRun, signature: string): Promise<SettlementCheck> {
    if (this.offramp.simulated && run.executionMode === "real") return { status: "failed", reason: "real funds cannot settle through a simulated off-ramp" };
    const minAmount = run.payment.requirement?.offrampNetUsdc;
    if (minAmount === undefined) return { status: "failed", reason: "no funding requirement" };
    const transfer = await verifyTokenTransfer(this.provider, signature, { mint: this.usdcMint, destinationOwner: this.depositAddress, minAmount, commitment: "confirmed" });
    if (transfer.status !== "confirmed") return transfer.status === "pending" ? { status: "pending" } : { status: "failed", reason: transfer.reason };
    return { status: "settled", reference: `${this.offramp.providerId}:${signature.slice(0, 16)}`, simulated: this.offramp.simulated };
  }
}
