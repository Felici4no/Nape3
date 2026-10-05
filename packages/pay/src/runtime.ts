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
  type CloakSigner,
  type RpcFailureDiagnostic,
  realCloakSdk,
  seedFromWalletSignature
} from "@nape3/payments/cloak";
import { reportToExtension } from "./bridge";
import { EncryptedLocalNoteStore } from "./encrypted-store";
import { PaymentFlow, settlementUnavailable, type PaymentRequest, type PrivateBalance } from "./flow";
import { createCapturingCloakRpc, dryRunSigner, type SimulationOutcome } from "./rpc-capture";
import { CLOAK_PROGRAM_ID, diagnoseShieldChain, type ShieldChainDiagnosis } from "./shield-diagnosis";
import { LocalIntentStore } from "./shield-intent";
import { displayError, SHIELD_AMOUNT_USDC, ShieldOperation, type ShieldDeps } from "./shield-op";
import { connectWallet, type ConnectedWallet } from "./wallet";
import { discoverStandardWallets, runV1SigningTest, type V1SigningResult } from "./v1-signing-test";
import {
  assertNoUserFundedAlt,
  dryRunModifyingSigner,
  guardedWalletSigner,
  RelayShieldGuard,
  type ModifyingSigner,
  type RelayGuardMode,
  type RelayShieldReport
} from "./relay-shield-guard";

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
  connection: CloakRpc = createCloakRpc(rpcUrl),
  signer: CloakSigner = wallet.cloakSigner()
): Promise<{ funding: CloakFunding; balance: PrivateBalance; keys: CloakKeys }> {
  const signature = await wallet.signMessage(derivationMessageBytes());
  const keys = await CloakKeys.fromSeed(await seedFromWalletSignature(signature));
  const funding = new CloakFunding({
    sdk: realCloakSdk,
    connection,
    signer,
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

/**
 * WOULD_SUCCEED / WOULD_FAIL only for a transaction that invokes the Cloak
 * program. Anything else (e.g. the SDK asking for another lookup table) is
 * NOT_A_SHIELD_SIMULATION, whatever its own result.
 */
export type ShieldSimulationVerdict = "WOULD_SUCCEED" | "WOULD_FAIL" | "RPC_REJECTED" | "NOT_A_SHIELD_SIMULATION";

export interface ShieldSimulation {
  verdict: ShieldSimulationVerdict;
  /** Message version the SDK was asked to build (0 = v0 + lookup tables, 1 = Transaction V1). */
  transactionVersion: 0 | 1;
  /** Why the verdict is NOT_A_SHIELD_SIMULATION. */
  verdictReason: string | null;
  /** Simulation of the shield (deposit) transaction: the attempt that invokes the Cloak program. */
  outcome: SimulationOutcome | null;
  /** SDK progress text during the run (public), e.g. "creating supplemental ALT". */
  stages: string[];
  /** Every transaction the SDK tried to send, simulated in order (a lookup-table creation would appear here too). */
  attempts: SimulationOutcome[];
  /** What stopped the SDK when no simulation was reached (proof, quote, RPC). */
  stoppedBy: string | null;
  lookupTables: string[];
}

export interface ShieldSession {
  operation: ShieldOperation;
  /** Connects the wallet for diagnosis only (no balance checks, no shield state machine). */
  connectForDiagnosis(silent: boolean): Promise<string>;
  /** The connected wallet's address, if any. */
  diagnosisWallet(): string | null;
  /** Whether Cloak keys are available (the derivation message was signed in this page). */
  unlocked(): boolean;
  /** Read-only: balances, latest signatures, lookup-table transaction and account, Cloak deposits. */
  diagnose(): Promise<ShieldChainDiagnosis & { privateUsdc: bigint | null }>;
  /**
   * Builds the same shield transaction through the Cloak SDK and only simulates it:
   * sendTransaction is never forwarded, the wallet is not asked to sign a transaction
   * (zero signature, sigVerify off), the existing lookup table is reused, notes are kept
   * in memory only, and the shield intent record is not touched.
   */
  simulate(lookupTables: string[], options?: { transactionVersion?: 0 | 1 }): Promise<ShieldSimulation>;
  /**
   * Asks the wallet to sign (signTransaction only) a harmless Transaction V1
   * (0-lamport transfer to itself), verifies the signature locally and
   * discards it. Never broadcast: a guard makes every send path throw.
   */
  testV1Signing(): Promise<V1SigningResult>;
  /**
   * Plan B dry run, no side effects: the v0 shield with relaySupplementalAlt,
   * where `/supplemental-alt` is answered locally (never sent to the relay),
   * the deposit is only simulated and the wallet signs nothing. Shows whether
   * the SDK reaches the relay request with a valid body, that its fallback to
   * a wallet-paid table is blocked, and the risk quote's measured lifetime.
   */
  simulateRelayPath(): Promise<RelayPathRun>;
  /**
   * FIRST REAL RELAY TEST. Requests the relay lookup table for real (the
   * relay writes and pays on chain), waits for it to become usable, then only
   * SIMULATES the deposit with it. The wallet signs no transaction and nothing
   * is broadcast from this app.
   */
  testRelayAlt(): Promise<RelayPathRun>;
  /** Guard report of the last real shield attempt (relay path). */
  lastRelayReport(): RelayShieldReport | null;
}

export type RelayPathVerdict =
  /** dry run: the SDK asked the relay for the table with a valid body, and the wallet-paid fallback was blocked. */
  | "READY_UP_TO_RELAY_ALT"
  /** relay test: the relay table was created and the deposit using it simulates successfully. */
  | "RELAY_ALT_DEPOSIT_WOULD_SUCCEED"
  | "RELAY_ALT_DEPOSIT_WOULD_FAIL"
  /** The deposit fit without a supplemental table (no relay call was needed). */
  | "FITS_WITHOUT_RELAY_ALT"
  /** The SDK never asked the relay (not eligible: no deposit nonce, not an SPL deposit…). */
  | "RELAY_ALT_NOT_REQUESTED"
  | "RELAY_ALT_FAILED"
  /** Anything else that stopped the run before a verdict. */
  | "STOPPED";

export interface RelayPathRun {
  mode: RelayGuardMode;
  verdict: RelayPathVerdict;
  reason: string;
  report: RelayShieldReport;
  /** Simulated transactions (a lookup-table creation would be refused before reaching here). */
  attempts: SimulationOutcome[];
  stages: string[];
  stoppedBy: string | null;
}

export function relayVerdict(mode: RelayGuardMode, report: RelayShieldReport, attempts: SimulationOutcome[], stoppedBy: string | null): Pick<RelayPathRun, "verdict" | "reason"> {
  const deposit = attempts.find((a) => a.transaction?.programIds.includes(CLOAK_PROGRAM_ID));
  const usesRelayTable = !!deposit && !!report.relayTable && !!deposit.transaction?.lookupTables.some((l) => l.table === report.relayTable);
  const validBody = !!report.relayRequest && report.relayRequest.nullifiers === 2 && report.relayRequest.bind0Bytes === 32 && !!report.relayRequest.mint && !!report.relayRequest.depositor;
  if (deposit && !usesRelayTable) {
    return deposit.ok
      ? { verdict: "FITS_WITHOUT_RELAY_ALT", reason: "the deposit fit with the relay's pre-built tables and simulated successfully; no supplemental table was needed" }
      : { verdict: "RELAY_ALT_DEPOSIT_WOULD_FAIL", reason: `the deposit (without a relay table) failed in simulation: ${deposit.diagnostic.message}` };
  }
  if (deposit) {
    return deposit.ok
      ? { verdict: "RELAY_ALT_DEPOSIT_WOULD_SUCCEED", reason: `deposit simulated successfully with the relay table ${report.relayTable}` }
      : { verdict: "RELAY_ALT_DEPOSIT_WOULD_FAIL", reason: deposit.diagnostic.message };
  }
  if (!report.relayRequest) return { verdict: "RELAY_ALT_NOT_REQUESTED", reason: stoppedBy ?? "the SDK did not ask the relay for a table" };
  if (mode === "dry-run") {
    if (validBody && (report.violation === "RELAY_ALT_FALLBACK_BLOCKED" || report.violation === "USER_FUNDED_ALT_BLOCKED")) {
      return {
        verdict: "READY_UP_TO_RELAY_ALT",
        reason: "the SDK asked the relay for the table with { mint, depositor, 2 nullifiers, 32-byte bind0 } (answered locally, not sent); its wallet-paid fallback was blocked"
      };
    }
    return { verdict: "STOPPED", reason: stoppedBy ?? report.violation ?? "unexpected" };
  }
  if (report.relayFailed) return { verdict: "RELAY_ALT_FAILED", reason: report.relayFailed };
  return { verdict: "STOPPED", reason: stoppedBy ?? report.violation ?? "no deposit was simulated" };
}

/** Exactly 1 USDC into the Cloak pool, signed by the injected wallet. Nothing is sent without confirm(). */
export function createShieldSession(): ShieldSession {
  let connected: ConnectedWallet | null = null;
  let unlocked: { funding: CloakFunding; keys: CloakKeys } | null = null;
  let lastFailure: RpcFailureDiagnostic | null = null;
  /** The relay-path guard of the shield attempt in progress, if any. */
  let activeGuard: RelayShieldGuard | null = null;
  let lastReport: RelayShieldReport | null = null;
  const capture = {
    onFailure: (diagnostic: RpcFailureDiagnostic) => (lastFailure = diagnostic),
    // Transport side of the rule: a lookup-table transaction is never forwarded, attempt or not.
    inspectSend: (tx: Parameters<typeof assertNoUserFundedAlt>[0]) => (activeGuard ? activeGuard.inspectSend(tx) : assertNoUserFundedAlt(tx))
  };
  /** The wallet signer every Cloak call from this session uses: never signs a lookup-table transaction. */
  const guardedSigner = (wallet: ConnectedWallet): CloakSigner => {
    const base = wallet.cloakSigner();
    if (base.kind !== "wallet") return base;
    return { ...base, signer: guardedWalletSigner(base.signer as unknown as ModifyingSigner, () => activeGuard) as unknown as typeof base.signer };
  };
  const deps: ShieldDeps = {
    connectWallet: async ({ silent }) => {
      connected = await connectWallet({ silent });
      return connected;
    },
    readPublicBalances: (owner) => readPublicBalances(createCloakRpc(shieldRpc().url), address(owner), USDC),
    unlock: async () => {
      if (!connected) throw new Error("wallet not connected");
      const url = shieldRpc().url;
      const { funding, keys } = await unlock(connected, url, createCapturingCloakRpc(url, "live", capture), guardedSigner(connected));
      unlocked = { funding, keys };
      return {
        shieldedUsdc: async () => (await funding.shieldedBalance()).total,
        // Plan B: v0 + relay-paid supplemental table, one wallet approval, no wallet-paid table ever.
        shield: async (amount, options) => {
          if (amount !== SHIELD_AMOUNT_USDC) throw new Error(`refused: this shield moves exactly ${SHIELD_AMOUNT_USDC} base units of USDC`);
          if (connected?.name !== "Phantom") {
            throw new Error(`refused: the relay lookup-table shield is enabled for Phantom only (connected: ${connected?.name ?? "none"})`);
          }
          const guard = new RelayShieldGuard({ mode: "live", onStage: (stage) => options.onProgress(`relay:${stage}`) });
          activeGuard = guard;
          const restore = guard.installFetchObserver(window);
          try {
            const result = await funding.shield(amount, {
              relaySupplementalAlt: true,
              transactionVersion: 0, // Phantom declares ["legacy", 0]; the guard also refuses anything but a v0 Cloak deposit
              onProgress: (stage) => {
                guard.onProgress(stage);
                options.onProgress(stage);
              }
            });
            guard.shielded();
            return { signature: result.signature };
          } catch (error) {
            // The SDK re-wraps errors; the guard's own abort says precisely what was refused.
            throw guard.lastAbort ?? error;
          } finally {
            restore();
            activeGuard = null;
            lastReport = guard.report();
          }
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

  /** One message signature (not a transaction) when the keys are not loaded yet. */
  const ensureUnlocked = async () => {
    if (unlocked) return unlocked;
    if (!connected) throw new Error("connect the wallet first");
    const url = shieldRpc().url;
    const { funding, keys } = await unlock(connected, url, createCapturingCloakRpc(url, "live", capture), guardedSigner(connected));
    unlocked = { funding, keys };
    return unlocked;
  };

  /** dry-run / relay-test: the relay path with a zero-signature signer and a simulate-only transport. */
  const runRelayPath = async (mode: "dry-run" | "relay-test"): Promise<RelayPathRun> => {
    if (!connected) throw new Error("connect the wallet first");
    const keys = (await ensureUnlocked()).keys;
    const guard = new RelayShieldGuard({ mode });
    const attempts: SimulationOutcome[] = [];
    const stages: string[] = [];
    const url = shieldRpc().url;
    const dryFunding = new CloakFunding({
      sdk: realCloakSdk,
      connection: createCapturingCloakRpc(url, "simulate-only", { onSimulation: (o) => attempts.push(o), measureCost: true, inspectSend: (tx) => guard.inspectSend(tx) }),
      signer: {
        kind: "wallet",
        signer: guard.wrapSigner(dryRunModifyingSigner(connected.address)) as never,
        signMessage: connected.signMessage,
        address: connected.address
      },
      keys,
      store: new MemoryNoteStore(),
      mint: USDC,
      log
    });
    let stoppedBy: string | null = null;
    const restore = guard.installFetchObserver(window);
    try {
      await dryFunding.shield(SHIELD_AMOUNT_USDC, {
        relaySupplementalAlt: true,
        onProgress: (stage) => {
          stages.push(stage.slice(0, 200));
          guard.onProgress(stage);
        }
      });
      stoppedBy = "the SDK reported success without a broadcast (unexpected)";
    } catch (error) {
      stoppedBy = guard.lastAbort ? `${guard.lastAbort.violation}: ${guard.lastAbort.message}` : displayError(error);
    } finally {
      restore();
    }
    const report = guard.report();
    return { mode, ...relayVerdict(mode, report, attempts, stoppedBy), report, attempts, stages, stoppedBy };
  };

  return {
    operation,
    async connectForDiagnosis(silent) {
      connected = await connectWallet({ silent });
      return connected.address;
    },
    diagnosisWallet: () => connected?.address ?? operation.state.wallet?.address ?? null,
    unlocked: () => unlocked !== null,
    async diagnose() {
      const walletAddress = connected?.address ?? operation.state.wallet?.address;
      if (!walletAddress) throw new Error("connect the wallet first");
      const chain = await diagnoseShieldChain(rpcCall, walletAddress, USDC);
      let privateUsdc: bigint | null = null;
      if (unlocked) privateUsdc = (await unlocked.funding.reconcileWithChain()).total;
      return { ...chain, privateUsdc };
    },
    async simulate(lookupTables, options = {}) {
      const transactionVersion = options.transactionVersion ?? 0;
      if (!connected) throw new Error("connect the wallet first");
      const keys = (await ensureUnlocked()).keys;
      const attempts: SimulationOutcome[] = [];
      const url = shieldRpc().url;
      const dryFunding = new CloakFunding({
        sdk: realCloakSdk,
        connection: createCapturingCloakRpc(url, "simulate-only", { onSimulation: (o) => attempts.push(o), measureCost: true }),
        signer: { kind: "wallet", signer: dryRunSigner(connected.address), signMessage: connected.signMessage, address: connected.address },
        keys,
        store: new MemoryNoteStore(),
        mint: USDC,
        log
      });
      let stoppedBy: string | null = null;
      const stages: string[] = [];
      try {
        // v1: lookup tables are still passed so the SDK skips its first depositor-signed ALT
        // (acquireDepositAlt runs before the version check); it then drops them for v1.
        await dryFunding.shield(SHIELD_AMOUNT_USDC, { lookupTables, transactionVersion, onProgress: (stage) => stages.push(stage.slice(0, 200)) });
        stoppedBy = "the SDK reported success without a broadcast (unexpected)";
      } catch (error) {
        if (attempts.length === 0) stoppedBy = displayError(error);
      }
      return { ...shieldVerdict(attempts), transactionVersion, stages, attempts, stoppedBy, lookupTables };
    },
    simulateRelayPath: () => runRelayPath("dry-run"),
    testRelayAlt: () => runRelayPath("relay-test"),
    lastRelayReport: () => lastReport,
    async testV1Signing() {
      if (!connected) throw new Error("connect the wallet first");
      return runV1SigningTest({
        walletAddress: connected.address,
        provider: connected.provider,
        standardWallets: () => discoverStandardWallets(window),
        guardTarget: window as never,
        latestBlockhash: async () => {
          const r = await rpcCall<{ value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
          return r.value;
        }
      });
    }
  };
}

/** Only a transaction that invokes the Cloak program counts as a shield simulation. */
export function shieldVerdict(attempts: SimulationOutcome[]): Pick<ShieldSimulation, "verdict" | "verdictReason" | "outcome"> {
  const shield = attempts.find((a) => a.transaction?.programIds.includes(CLOAK_PROGRAM_ID));
  if (shield) {
    if (shield.rpcRejected) return { verdict: "RPC_REJECTED", verdictReason: `the RPC refused to simulate the deposit: ${shield.diagnostic.message}`, outcome: shield };
    return { verdict: shield.ok ? "WOULD_SUCCEED" : "WOULD_FAIL", verdictReason: null, outcome: shield };
  }
  const alt = attempts.find((a) => a.transaction?.altInstructions.length);
  const reason = alt
    ? `the SDK tried to ${alt.transaction!.altInstructions.join(" + ")} first (the given lookup tables do not make the deposit fit in a transaction); it stopped there and never built the deposit`
    : attempts.length
      ? "no simulated transaction invoked the Cloak program"
      : "the SDK stopped before building any transaction";
  return { verdict: "NOT_A_SHIELD_SIMULATION", verdictReason: reason, outcome: null };
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
