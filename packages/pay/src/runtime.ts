import { address, createCloakRpc } from "@cloak.dev/sdk";
import { assessFunding, type AgentState, type FundingAssessment, type FundingRequirement } from "@nape3/agent";
import type { Cents } from "@nape3/domain";
import { MockOfframp, USDC_MINT } from "@nape3/payments";
import {
  CloakFunding,
  CloakKeys,
  createCloakLogger,
  derivationMessageBytes,
  grossUpWithdrawal,
  readPublicBalances,
  realCloakSdk,
  seedFromWalletSignature
} from "@nape3/payments/cloak";
import { reportToExtension } from "./bridge";
import { EncryptedLocalNoteStore } from "./encrypted-store";
import { PaymentFlow, settlementUnavailable, type PaymentRequest, type PrivateBalance } from "./flow";
import { connectWallet, type ConnectedWallet } from "./wallet";

/**
 * Real wiring of UPAY3FOOD Pay: injected wallet (Phantom/Solflare), Solana
 * RPC, Cloak SDK, encrypted local notes, extension bridge. Browser-only.
 */

export const USDC = address(USDC_MINT["mainnet-beta"]);
export const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
const RPC_KEY = "upay3food.rpc";
const log = createCloakLogger((line) => console.info(line));

export function getRpcUrl(): string {
  try {
    return localStorage.getItem(RPC_KEY) || DEFAULT_RPC;
  } catch {
    return DEFAULT_RPC;
  }
}

export function setRpcUrl(url: string): void {
  try {
    if (url) localStorage.setItem(RPC_KEY, url);
    else localStorage.removeItem(RPC_KEY);
  } catch {
    /* storage unavailable: keep the default */
  }
}

/** One signature (not a transaction): derives the Cloak key and the local note-encryption key. */
async function unlock(wallet: ConnectedWallet): Promise<{ funding: CloakFunding; balance: PrivateBalance }> {
  const signature = await wallet.signMessage(derivationMessageBytes());
  const keys = await CloakKeys.fromSeed(await seedFromWalletSignature(signature));
  const funding = new CloakFunding({
    sdk: realCloakSdk,
    connection: createCloakRpc(getRpcUrl()),
    signer: wallet.cloakSigner(),
    keys,
    store: await EncryptedLocalNoteStore.create(wallet.address, signature),
    mint: USDC,
    log
  });
  return {
    funding,
    balance: { shieldedUsdc: async () => (await funding.shieldedBalance()).total, shield: (amount) => funding.shield(amount) }
  };
}

/** USDC the (mock) off-ramp needs for `amountCents`, and the Cloak gross-up. */
export async function quoteFunding(amountCents: Cents): Promise<{ offrampNetUsdc: bigint; grossUsdc: bigint; simulated: boolean }> {
  const quote = await new MockOfframp().quote(amountCents, new Date());
  return { offrampNetUsdc: quote.usdcRequired, grossUsdc: grossUpWithdrawal(quote.usdcRequired), simulated: true };
}

export function createPaymentFlow(request: PaymentRequest): PaymentFlow {
  let connected: ConnectedWallet | null = null;
  return new PaymentFlow(
    {
      connectWallet: async ({ silent }) => {
        connected = await connectWallet({ silent });
        return connected;
      },
      unlockPrivateBalance: async () => {
        if (!connected) throw new Error("wallet not connected");
        return (await unlock(connected)).balance;
      },
      readPublicBalances: (owner) => readPublicBalances(createCloakRpc(getRpcUrl()), address(owner), USDC),
      quote: quoteFunding,
      settle: settlementUnavailable,
      report: (context, extra) => reportToExtension(context, extra.shieldedUsdc, request),
      now: () => new Date()
    },
    request
  );
}

// ---------------------------------------------------------------------------
// Wallet page session (no purchase): connect, unlock, balances, readiness.
// ---------------------------------------------------------------------------

export interface WalletSnapshot {
  name: string;
  address: string;
  publicUsdc: bigint | null;
  solLamports: bigint | null;
  shieldedUsdc: bigint | null;
  checkedAt: string | null;
  /** Agent funding state for this wallet (WALLET_CONNECTED / FUNDS_CHECKED / SHIELD_REQUIRED / PAYMENT_READY). */
  agentState: AgentState;
  /** Readiness against a reference purchase, when one is given. */
  assessment: FundingAssessment | null;
}

export class WalletSession {
  private wallet: ConnectedWallet | null = null;
  private privateBalance: PrivateBalance | null = null;

  async connect(silent: boolean): Promise<WalletSnapshot> {
    this.wallet = await connectWallet({ silent });
    return this.snapshot(null);
  }

  async disconnect(): Promise<void> {
    await this.wallet?.disconnect();
    this.wallet = null;
    this.privateBalance = null;
  }

  /** Reads public balances; unlocks (one signature) the shielded balance when `includePrivate`. */
  async check(options: { includePrivate: boolean; referenceCents?: Cents }): Promise<WalletSnapshot> {
    if (!this.wallet) throw new Error("wallet not connected");
    if (options.includePrivate && !this.privateBalance) this.privateBalance = (await unlock(this.wallet)).balance;
    const [publicBalances, shielded] = await Promise.all([
      readPublicBalances(createCloakRpc(getRpcUrl()), address(this.wallet.address), USDC),
      this.privateBalance ? this.privateBalance.shieldedUsdc() : Promise.resolve(null)
    ]);
    let assessment: FundingAssessment | null = null;
    if (options.referenceCents !== undefined && shielded !== null) {
      const quote = await quoteFunding(options.referenceCents);
      const requirement: FundingRequirement = {
        checkoutTotalCents: options.referenceCents,
        offrampNetUsdc: quote.offrampNetUsdc,
        cloakFeeUsdc: quote.grossUsdc - quote.offrampNetUsdc,
        grossUsdc: quote.grossUsdc,
        destination: "pix-selected-via-offramp",
        quoteSimulated: quote.simulated
      };
      assessment = assessFunding(requirement, {
        address: this.wallet.address,
        publicUsdc: publicBalances.publicUsdc,
        shieldedUsdc: shielded,
        solLamports: publicBalances.solLamports,
        checkedAt: new Date().toISOString()
      });
    }
    return {
      name: this.wallet.name,
      address: this.wallet.address,
      publicUsdc: publicBalances.publicUsdc,
      solLamports: publicBalances.solLamports,
      shieldedUsdc: shielded,
      checkedAt: new Date().toISOString(),
      agentState: assessment ? (assessment.kind === "ready" ? "PAYMENT_READY" : "SHIELD_REQUIRED") : shielded === null ? "WALLET_CONNECTED" : "FUNDS_CHECKED",
      assessment
    };
  }

  private snapshot(_: null): WalletSnapshot {
    return {
      name: this.wallet!.name,
      address: this.wallet!.address,
      publicUsdc: null,
      solLamports: null,
      shieldedUsdc: null,
      checkedAt: null,
      agentState: "WALLET_CONNECTED",
      assessment: null
    };
  }
}
