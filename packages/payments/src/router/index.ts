import { formatBRL, type Cents } from "@nape3/domain";
import type { OfframpProvider, OfframpQuote, PixPayoutResult } from "../offramp";
import { parsePixBrCode } from "../pix";
import { formatUsdc, type SolanaCluster, type UsdcBaseUnits, type WalletAdapter } from "../solana";

/**
 * Plans and (in simulation only) executes: wallet → USDC → off-ramp → Pix.
 * Execution requires an explicit user authorization for the exact amount.
 */

/**
 * Where the USDC that pays the off-ramp comes from. The router does not care
 * how a source moves funds; it only plans with its balance, cost and copy.
 */
export interface FundingSource {
  readonly kind: "public-wallet" | "cloak-shielded";
  readonly simulated: boolean;
  /** USDC available to this source. */
  available(): Promise<UsdcBaseUnits>;
  /** Extra cost (base units) of delivering `amount` to the off-ramp through this source. */
  costFor(amount: UsdcBaseUnits): UsdcBaseUnits;
  /** Human-readable step(s) for the plan. */
  describe(amount: UsdcBaseUnits, depositAddress: string, cluster: SolanaCluster): string[];
  /** Privacy statement shown with the plan (null = none). */
  readonly privacyNote: string | null;
  /** Deliver at least `amount` to `to`. Returns the on-chain signature. */
  fund(to: string, amount: UsdcBaseUnits, memo: string): Promise<{ signature: string }>;
}

/** The original path: a USDC transfer from the user's public wallet (fully linkable on-chain). */
export function publicWalletFunding(wallet: WalletAdapter, cluster: SolanaCluster): FundingSource {
  return {
    kind: "public-wallet",
    simulated: wallet.simulated,
    privacyNote: null,
    available: () => wallet.usdcBalance(cluster),
    costFor: () => 0n,
    describe: (amount, depositAddress) => [`Send ${formatUsdc(amount)} on ${cluster} from your wallet to ${depositAddress}`],
    fund: async (to, amount, memo) =>
      wallet.signAndSendUsdcTransfer({ cluster, from: await wallet.publicKey(), to, amount, memo })
  };
}

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
  funding: {
    kind: FundingSource["kind"];
    /** Extra cost of the funding path, e.g. Cloak's withdraw fee. */
    costUsdc: UsdcBaseUnits;
    privacyNote: string | null;
  };
}

export class PaymentRouter {
  private readonly funding: FundingSource;

  constructor(
    wallet: WalletAdapter,
    private readonly offramp: OfframpProvider,
    private readonly cluster: SolanaCluster = "devnet",
    funding?: FundingSource
  ) {
    this.funding = funding ?? publicWalletFunding(wallet, cluster);
  }

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
    const cost = this.funding.costFor(quote.usdcRequired);
    const balance = await this.funding.available();
    if (balance < quote.usdcRequired + cost) {
      blockers.push(`insufficient USDC in ${this.funding.kind}: need ${formatUsdc(quote.usdcRequired + cost)}`);
    }
    // Real money must never be sent to a simulated off-ramp's placeholder address.
    if (!this.funding.simulated && this.offramp.simulated) {
      blockers.push("real funding cannot pay a simulated off-ramp; integrate a licensed off-ramp first");
    }
    const simulated = this.funding.simulated || this.offramp.simulated;
    return {
      pixPayload: parsed.code.payload,
      amountCents,
      quote,
      simulated,
      blockers,
      steps: [
        `Pay ${formatBRL(amountCents)} to ${parsed.code.merchantName ?? "Pix recipient"} via Pix`,
        `Off-ramp ${this.offramp.providerId}: fee ${formatBRL(quote.feeCents)}, rate ${formatBRL(quote.rateCentsPerUsdc as Cents)}/USDC`,
        ...this.funding.describe(quote.usdcRequired, quote.depositAddress, this.cluster),
        "Off-ramp settles the Pix payout",
        ...(simulated ? ["SIMULATION: no real funds move"] : [])
      ],
      funding: { kind: this.funding.kind, costUsdc: cost, privacyNote: this.funding.privacyNote }
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
    const { signature } = await this.funding.fund(plan.quote.depositAddress, plan.quote.usdcRequired, plan.quote.quoteId);
    return this.offramp.payoutToPix({ quote: plan.quote, pixPayload: plan.pixPayload, usdcTransferSignature: signature });
  }
}
