import { address, createCloakRpc, type CloakRpc } from "@cloak.dev/sdk";
import { assessFunding, type AgentState, type FundingAssessment, type FundingRequirement } from "@nape3/agent";
import type { Cents } from "@nape3/domain";
import { MockOfframp, USDC_MINT } from "@nape3/payments";
import {
  CloakFunding,
  CloakKeys,
  createCloakLogger,
  derivationMessageBytes,
  grossUpWithdrawal,
  MemoryNoteStore,
  readPublicBalances,
  type RpcFailureDiagnostic,
  realCloakSdk,
  seedFromWalletSignature
} from "@nape3/payments/cloak";
import { reportToExtension } from "./bridge";
import { EncryptedLocalNoteStore } from "./encrypted-store";
import { PaymentFlow, settlementUnavailable, type PaymentRequest, type PrivateBalance } from "./flow";
import { createCapturingCloakRpc, dryRunSigner, type SimulationOutcome } from "./rpc-capture";
import { diagnoseShieldChain, type ShieldChainDiagnosis } from "./shield-diagnosis";
import { LocalIntentStore } from "./shield-intent";
import { displayError, SHIELD_AMOUNT_USDC, ShieldOperation, type ShieldDeps } from "./shield-op";
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
async function unlock(
  wallet: ConnectedWallet,
  rpcUrl: string = getRpcUrl(),
  connection: CloakRpc = createCloakRpc(rpcUrl)
): Promise<{ funding: CloakFunding; balance: PrivateBalance; keys: CloakKeys }> {
  const signature = await wallet.signMessage(derivationMessageBytes());
  const keys = await CloakKeys.fromSeed(await seedFromWalletSignature(signature));
  const funding = new CloakFunding({
    sdk: realCloakSdk,
    connection,
    signer: wallet.cloakSigner(),
    keys,
    store: await EncryptedLocalNoteStore.create(wallet.address, signature),
    mint: USDC,
    log
  });
  return {
    funding,
    keys,
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
// Standalone shield (no purchase): the first real Cloak shield from /shield.
// ---------------------------------------------------------------------------

/** Same-origin Solana RPC proxy (apps/web). It forwards to the RPC Fast endpoint held in server-side env. */
export const SOLANA_RPC_PROXY_PATH = "/api/solana-rpc";

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "[::1]" || /^127\./.test(hostname);
}

export interface ShieldRpc {
  url: string;
  /** true: the deployed site's server-side RPC Fast proxy. false: local development fallback. */
  viaProxy: boolean;
  /** Safe to display: never includes a path or query that could carry a key. */
  label: string;
}

/**
 * RPC used by /shield. On the deployed site it is always the same-origin proxy,
 * so nothing is pasted and no key reaches the browser. The Cloak SDK refuses an
 * RPC served by this machine, so on localhost the proxy cannot be used and the
 * manual endpoint (or the public default) applies, for development only.
 */
export function shieldRpc(): ShieldRpc {
  if (!isLoopbackHostname(location.hostname)) {
    return { url: `${location.origin}${SOLANA_RPC_PROXY_PATH}`, viaProxy: true, label: `${location.host}${SOLANA_RPC_PROXY_PATH}` };
  }
  let host = "invalid RPC url";
  try {
    host = new URL(getRpcUrl()).hostname;
  } catch {
    /* keep the placeholder */
  }
  return { url: getRpcUrl(), viaProxy: false, label: host };
}

/** "rpc-fast" only through the proxy, which can only reach the configured RPC Fast endpoint. */
function rpcProviderLabel(): string {
  const rpc = shieldRpc();
  return rpc.viaProxy || /(^|\.)rpcfast\.com$/.test(rpc.label) ? "rpc-fast" : "custom";
}

/** Read-only JSON-RPC call. Errors never include the URL. */
async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(shieldRpc().url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  }).catch(() => {
    throw new Error(`rpc ${method}: network error`);
  });
  if (!response.ok) throw new Error(`rpc ${method}: HTTP ${response.status}`);
  const envelope = (await response.json()) as { result?: T; error?: { message?: string } };
  if (envelope.error) throw new Error(`rpc ${method}: ${envelope.error.message ?? "error"}`);
  return envelope.result as T;
}

export interface ShieldSimulation {
  /** Simulation of the shield (deposit) transaction; null if the SDK stopped before building it. */
  outcome: SimulationOutcome | null;
  /** Every transaction the SDK tried to send, simulated in order (a lookup-table creation would appear here too). */
  attempts: SimulationOutcome[];
  /** What stopped the SDK when no simulation was reached (proof, quote, RPC). */
  stoppedBy: string | null;
  lookupTables: string[];
}

export interface ShieldSession {
  operation: ShieldOperation;
  /** Read-only: balances, latest signatures, lookup-table transaction and account, Cloak deposits. */
  diagnose(): Promise<ShieldChainDiagnosis & { privateUsdc: bigint | null }>;
  /**
   * Builds the same shield transaction through the Cloak SDK and only simulates it:
   * sendTransaction is never forwarded, the wallet is not asked to sign a transaction
   * (zero signature, sigVerify off), the existing lookup table is reused, notes are kept
   * in memory only, and the shield intent record is not touched.
   */
  simulate(lookupTables: string[]): Promise<ShieldSimulation>;
}

/** Exactly 1 USDC into the Cloak pool, signed by the injected wallet. Nothing is sent without confirm(). */
export function createShieldSession(): ShieldSession {
  let connected: ConnectedWallet | null = null;
  let unlocked: { funding: CloakFunding; keys: CloakKeys } | null = null;
  let lastFailure: RpcFailureDiagnostic | null = null;
  const capture = { onFailure: (diagnostic: RpcFailureDiagnostic) => (lastFailure = diagnostic) };
  const deps: ShieldDeps = {
    connectWallet: async ({ silent }) => {
      connected = await connectWallet({ silent });
      return connected;
    },
    readPublicBalances: (owner) => readPublicBalances(createCloakRpc(shieldRpc().url), address(owner), USDC),
    unlock: async () => {
      if (!connected) throw new Error("wallet not connected");
      const url = shieldRpc().url;
      const { funding, keys } = await unlock(connected, url, createCapturingCloakRpc(url, "live", capture));
      unlocked = { funding, keys };
      return {
        shieldedUsdc: async () => (await funding.shieldedBalance()).total,
        shield: async (amount, options) => {
          const result = await funding.shield(amount, options);
          return { signature: result.signature };
        },
        reconcile: async () => (await funding.reconcileWithChain()).total
      };
    },
    readTransaction: async (signature) => {
      const tx = await rpcCall<{ slot: number; blockTime: number | null } | null>("getTransaction", [
        signature,
        { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 1 }
      ]);
      return tx ? { slot: tx.slot, blockTime: tx.blockTime } : null;
    },
    intents: new LocalIntentStore(),
    lastRpcFailure: () => lastFailure,
    resetRpcFailure: () => {
      lastFailure = null;
    },
    get provider() {
      return rpcProviderLabel();
    },
    now: () => new Date(),
    newId: () => crypto.randomUUID()
  };
  const operation = new ShieldOperation(deps, SHIELD_AMOUNT_USDC);

  return {
    operation,
    async diagnose() {
      const wallet = operation.state.wallet;
      if (!wallet) throw new Error("connect the wallet first");
      const chain = await diagnoseShieldChain(rpcCall, wallet.address, USDC);
      let privateUsdc: bigint | null = null;
      if (unlocked) privateUsdc = (await unlocked.funding.reconcileWithChain()).total;
      return { ...chain, privateUsdc };
    },
    async simulate(lookupTables) {
      if (!connected || !unlocked) throw new Error("unlock Cloak first (one message signature, not a transaction)");
      const attempts: SimulationOutcome[] = [];
      const url = shieldRpc().url;
      const dryFunding = new CloakFunding({
        sdk: realCloakSdk,
        connection: createCapturingCloakRpc(url, "simulate-only", { onSimulation: (o) => attempts.push(o) }),
        signer: { kind: "wallet", signer: dryRunSigner(connected.address), signMessage: connected.signMessage, address: connected.address },
        keys: unlocked.keys,
        store: new MemoryNoteStore(),
        mint: USDC,
        log
      });
      let stoppedBy: string | null = null;
      try {
        await dryFunding.shield(SHIELD_AMOUNT_USDC, { lookupTables });
        stoppedBy = "the SDK reported success without a broadcast (unexpected)";
      } catch (error) {
        if (attempts.length === 0) stoppedBy = displayError(error);
      }
      return { outcome: attempts.at(-1) ?? null, attempts, stoppedBy, lookupTables };
    }
  };
}

/** Backwards-compatible: the operation alone. */
export function createShieldOperation(): ShieldOperation {
  return createShieldSession().operation;
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
