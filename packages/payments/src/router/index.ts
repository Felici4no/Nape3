import { formatBRL, type Cents } from "@nape3/domain";
import type { OfframpProvider, OfframpQuote, PixPayoutResult } from "../offramp";
import { parsePixBrCode } from "../pix";
import { formatUsdc, type SolanaCluster, type WalletAdapter } from "../solana";

/**
 * Plans and (in simulation only) executes: wallet → USDC → off-ramp → Pix.
 * Execution requires an explicit user authorization for the exact amount.
 */

export interface PaymentAuthorization {
  confirmedByUser: true;
  amountCents: Cents;
  at: string;
}

export interface RoutePlan {
  pixPayload: string;
  amountCents: Cents;
  quote: OfframpQuote;
  steps: string[];
  simulated: boolean;
  blockers: string[];
}

export class PaymentRouter {
  constructor(
    private readonly wallet: WalletAdapter,
    private readonly offramp: OfframpProvider,
    private readonly cluster: SolanaCluster = "devnet"
  ) {}

  async plan(pixPayload: string, now: Date): Promise<RoutePlan> {
    const parsed = parsePixBrCode(pixPayload);
    if (!parsed.ok) throw new Error(`invalid Pix payload: ${parsed.error}`);
    const blockers: string[] = [];
    if (!parsed.code.crcValid) blockers.push("Pix payload CRC is invalid");
    if (parsed.code.amountCents === undefined) {
      blockers.push("Pix payload has no amount (dynamic charge): the amount must be confirmed on the PSP side");
    }
    const amountCents = parsed.code.amountCents ?? (0 as Cents);
    const quote = await this.offramp.quote(amountCents, now);
    const balance = await this.wallet.usdcBalance(this.cluster);
    if (balance < quote.usdcRequired) blockers.push(`insufficient USDC: need ${formatUsdc(quote.usdcRequired)}`);
    const simulated = this.wallet.simulated || this.offramp.simulated;
    return {
      pixPayload: parsed.code.payload,
      amountCents,
      quote,
      simulated,
      blockers,
      steps: [
        `Pay ${formatBRL(amountCents)} to ${parsed.code.merchantName ?? "Pix recipient"} via Pix`,
        `Off-ramp ${this.offramp.providerId}: fee ${formatBRL(quote.feeCents)}, rate ${formatBRL(quote.rateCentsPerUsdc as Cents)}/USDC`,
        `Send ${formatUsdc(quote.usdcRequired)} on ${this.cluster} to ${quote.depositAddress}`,
        "Off-ramp settles the Pix payout",
        ...(simulated ? ["SIMULATION: no real funds move"] : [])
      ]
    };
  }

  async execute(plan: RoutePlan, authorization: PaymentAuthorization, now: Date): Promise<PixPayoutResult> {
    if (authorization.confirmedByUser !== true) throw new Error("explicit user authorization required");
    if (authorization.amountCents !== plan.amountCents) throw new Error("authorization amount does not match plan");
    if (plan.blockers.length > 0) throw new Error(`route blocked: ${plan.blockers.join("; ")}`);
    if (Date.parse(plan.quote.expiresAt) <= now.getTime()) throw new Error("off-ramp quote expired");
    if (!plan.simulated) {
      // Deliberate: there is no audited real-money path in this MVP.
      throw new Error("real payments are not enabled in this MVP");
    }
    const { signature } = await this.wallet.signAndSendUsdcTransfer({
      cluster: this.cluster,
      from: await this.wallet.publicKey(),
      to: plan.quote.depositAddress,
      amount: plan.quote.usdcRequired,
      memo: plan.quote.quoteId
    });
    return this.offramp.payoutToPix({ quote: plan.quote, pixPayload: plan.pixPayload, usdcTransferSignature: signature });
  }
}
