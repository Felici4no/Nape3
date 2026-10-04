import type { Cents } from "@nape3/domain";
import type { UsdcBaseUnits } from "../solana";
import { brlCentsToUsdcBaseUnits } from "../solana";

/**
 * Off-ramp boundary: converts USDC into a BRL Pix payout. No real provider is
 * integrated; any real implementation must be a licensed partner.
 */

export interface OfframpQuote {
  quoteId: string;
  providerId: string;
  brlAmountCents: Cents;
  feeCents: Cents;
  /** Integer BRL cents per 1 USDC. */
  rateCentsPerUsdc: number;
  usdcRequired: UsdcBaseUnits;
  /** Where the USDC must be sent for this quote. */
  depositAddress: string;
  expiresAt: string;
}

export interface PixPayoutRequest {
  quote: OfframpQuote;
  /** Visible Pix Copia e Cola payload the user is paying. */
  pixPayload: string;
  usdcTransferSignature: string;
}

export interface PixPayoutResult {
  status: "settled" | "pending" | "failed";
  reference: string;
  simulated: boolean;
}

export interface OfframpProvider {
  readonly providerId: string;
  readonly simulated: boolean;
  quote(brlAmountCents: Cents, now: Date): Promise<OfframpQuote>;
  payoutToPix(request: PixPayoutRequest): Promise<PixPayoutResult>;
}

export const SIMULATED_OFFRAMP_DEPOSIT_ADDRESS = "2VH5VUHmCpGXFj66qVLTpBWqFhDxJNWA53oG65i2mn56";

/** Deterministic mock off-ramp. Simulated: it does not pay anything. */
export class MockOfframp implements OfframpProvider {
  readonly providerId = "mock-offramp";
  readonly simulated = true;
  constructor(
    private readonly rateCentsPerUsdc = 540,
    private readonly feeBps = 100
  ) {}

  async quote(brlAmountCents: Cents, now: Date): Promise<OfframpQuote> {
    const feeCents = Math.ceil((brlAmountCents * this.feeBps) / 10_000) as Cents;
    return {
      quoteId: `mockq-${brlAmountCents}-${now.getTime()}`,
      providerId: this.providerId,
      brlAmountCents,
      feeCents,
      rateCentsPerUsdc: this.rateCentsPerUsdc,
      usdcRequired: brlCentsToUsdcBaseUnits(brlAmountCents + feeCents, this.rateCentsPerUsdc),
      // Valid base58 placeholder = sha256("upay3food:simulated-offramp-deposit"); nobody holds its key.
      // Never send real funds here: the router blocks real funding to a simulated off-ramp.
      depositAddress: SIMULATED_OFFRAMP_DEPOSIT_ADDRESS,
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString()
    };
  }

  async payoutToPix(request: PixPayoutRequest): Promise<PixPayoutResult> {
    return { status: "settled", reference: `simulated-payout-${request.quote.quoteId}`, simulated: true };
  }
}
