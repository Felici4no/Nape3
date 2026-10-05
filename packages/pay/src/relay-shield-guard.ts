import { getTransactionEncoder } from "@solana/kit";
import { ALT_PROGRAM_ID, CLOAK_PROGRAM_ID } from "./shield-diagnosis";
import { decodeTransaction, type DecodedTransaction } from "./tx-decode";

/**
 * Plan B for Phantom: a v0 Cloak deposit whose supplemental lookup table is
 * created and paid by the Cloak relay (`relaySupplementalAlt`), so the
 * wallet signs exactly one transaction: the deposit.
 *
 * The Cloak SDK (0.2.5) has no switch for two behaviours we cannot accept,
 * so this module enforces them from outside, with no SDK patch:
 *
 *  1. On any relay failure the SDK falls back to a depositor-signed
 *     CreateLookupTable + ExtendLookupTable (rent ~0.0023 SOL from the user,
 *     plus an extra wallet prompt). Every wallet signature passes through
 *     `inspect()`: a transaction that invokes the Address Lookup Table program
 *     is refused before the wallet sees it. `onProgress()` aborts as soon as
 *     the SDK announces the fallback. The transport guard refuses to forward
 *     such a transaction too (rpc-capture `inspectSend`).
 *  2. The SDK re-signs on its own: blockhash refresh (up to 2), transient
 *     transport errors (up to 3), packet-size tiers. During an attempt, only
 *     one signature is allowed; a second is refused (no automatic retry).
 *
 * Risk-quote freshness. The SDK's order is fixed and has to be:
 *
 *   risk quote (relay /range-quote, carries the deposit nonce)
 *   → relay /supplemental-alt { bind0: nonce, nullifiers, depositor, mint }
 *   → slot gate: wait until the table's lastExtendedSlot < current slot
 *   → build the final v0 message → wallet signature → send
 *
 * The quote cannot come after the table: the table is bound to the quote's
 * nonce (bind0), and it must hold riskNoncePda(nonce), which the deposit
 * instruction writes. A quote fetched later carries a new nonce the table
 * does not cover. So "fresh" here means:
 *   - nothing user-paced runs between the quote and the one wallet prompt
 *     (no wallet-signed table, no second approval);
 *   - right before the wallet is asked, and again right after it returns
 *     (before the SDK sends), the quote's age and, when the signed quote
 *     message carries one, its expiry are checked; a stale quote aborts
 *     with nothing broadcast.
 */

export const CLOAK_RELAY_ORIGIN = "https://api.cloak.ag";

export type RelayShieldStage =
  | "PREPARING_PROOF"
  | "FETCHING_RISK_QUOTE"
  | "PREPARING_RELAY_ALT"
  | "WAITING_FOR_ALT_WARMUP"
  | "CHECKING_QUOTE_FRESHNESS"
  | "WALLET_SIGNATURE_REQUIRED"
  | "SUBMITTING"
  | "CONFIRMING"
  | "SHIELDED";

export type RelayShieldViolation =
  /** A transaction invoking the Address Lookup Table program reached the wallet signer or the transport. */
  | "USER_FUNDED_ALT_BLOCKED"
  /** The SDK announced its fallback to a depositor-signed table after a relay failure. */
  | "RELAY_ALT_FALLBACK_BLOCKED"
  /** The SDK asked for a second wallet signature during one attempt (its internal retry). */
  | "SECOND_SIGNATURE_BLOCKED"
  /** The risk quote is too old (or too close to expiry) to ask the wallet / to send. */
  | "RISK_QUOTE_STALE"
  /** Something other than a v0 Cloak deposit was about to be signed. */
  | "UNEXPECTED_TRANSACTION";

export class RelayShieldAbort extends Error {
  override name = "RelayShieldAbort";
  constructor(
    readonly violation: RelayShieldViolation,
    message: string,
    /** true when the wallet's deposit signature was never handed to the SDK for sending. */
    readonly beforeBroadcast: boolean
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Risk quote inspection
// ---------------------------------------------------------------------------

export interface QuoteTimestampCandidate {
  offset: number;
  /** Unix seconds. */
  value: number;
  /** value − fetch time, seconds. */
  secondsFromFetch: number;
}

export interface QuoteInfo {
  fetchedAtMs: number;
  messageLength: number;
  /** First byte of the signed message (1 = deposit quote). */
  tag: number | null;
  /** i64 LE fields that look like Unix timestamps within ±1 h of the fetch. Layout is not documented, so all are reported. */
  timestampCandidates: QuoteTimestampCandidate[];
  /** The earliest candidate later than the fetch time, taken as the quote's expiry. null: not found. */
  expiresAtMs: number | null;
}

function hexBytes(hex: string): Uint8Array | null {
  const clean = hex.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2) return null;
  return Uint8Array.from(clean.match(/../g) ?? [], (b) => parseInt(b, 16));
}

/** Reads the relay's signed quote message (hex) for freshness. Public data only: wallet, mint, amount, nonce, timestamps. */
export function inspectRangeQuote(messageHex: string, fetchedAtMs: number): QuoteInfo {
  const bytes = hexBytes(messageHex) ?? new Uint8Array();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fetchSec = fetchedAtMs / 1000;
  const timestampCandidates: QuoteTimestampCandidate[] = [];
  for (let offset = 1; offset + 8 <= bytes.length; offset++) {
    const value = Number(view.getBigInt64(offset, true));
    if (Math.abs(value - fetchSec) <= 3600) timestampCandidates.push({ offset, value, secondsFromFetch: Math.round(value - fetchSec) });
  }
  const future = timestampCandidates.filter((c) => c.value > fetchSec).sort((a, b) => a.value - b.value);
  return {
    fetchedAtMs,
    messageLength: bytes.length,
    tag: bytes.length ? bytes[0]! : null,
    timestampCandidates,
    expiresAtMs: future.length ? future[0]!.value * 1000 : null
  };
}

export interface FreshnessPolicy {
  /** Before the wallet prompt: maximum quote age. */
  maxAgeAtPromptMs: number;
  /** Before the wallet prompt, when the expiry is known: minimum time left (the user still has to approve, then it must land). */
  minRemainingAtPromptMs: number;
  /** After the wallet returns, before the SDK sends: maximum quote age. */
  maxAgeAtSendMs: number;
  /** After the wallet returns, when the expiry is known: minimum time left for the transaction to land. */
  minRemainingAtSendMs: number;
}

/**
 * Measured on mainnet (first relay test, 2026-10-05): the relay's deposit
 * quote carries an expiry 599 s after it is issued, and the relay table was
 * usable 2.7 s after the quote (597 s left at the wallet prompt). These
 * limits leave the user minutes to approve while staying well inside that
 * window. A stale quote only aborts the attempt before broadcast.
 */
export const DEFAULT_FRESHNESS: FreshnessPolicy = {
  maxAgeAtPromptMs: 60_000,
  minRemainingAtPromptMs: 120_000,
  maxAgeAtSendMs: 300_000,
  minRemainingAtSendMs: 60_000
};

export function quoteFreshness(
  quote: QuoteInfo | null,
  nowMs: number,
  phase: "prompt" | "send",
  policy: FreshnessPolicy = DEFAULT_FRESHNESS
): { fresh: boolean; ageMs: number | null; remainingMs: number | null; reason: string } {
  if (!quote) return { fresh: false, ageMs: null, remainingMs: null, reason: "no risk quote was observed for this attempt" };
  const ageMs = nowMs - quote.fetchedAtMs;
  const remainingMs = quote.expiresAtMs === null ? null : quote.expiresAtMs - nowMs;
  const maxAge = phase === "prompt" ? policy.maxAgeAtPromptMs : policy.maxAgeAtSendMs;
  const minRemaining = phase === "prompt" ? policy.minRemainingAtPromptMs : policy.minRemainingAtSendMs;
  if (ageMs > maxAge) return { fresh: false, ageMs, remainingMs, reason: `risk quote is ${Math.round(ageMs / 1000)}s old (limit ${maxAge / 1000}s before ${phase === "prompt" ? "asking the wallet" : "sending"})` };
  if (remainingMs !== null && remainingMs < minRemaining) {
    return { fresh: false, ageMs, remainingMs, reason: `risk quote expires in ${Math.round(remainingMs / 1000)}s (needs ${minRemaining / 1000}s before ${phase === "prompt" ? "asking the wallet" : "sending"})` };
  }
  return { fresh: true, ageMs, remainingMs, reason: "fresh" };
}

// ---------------------------------------------------------------------------
// Transaction checks (shared by the signer guard and the transport guard)
// ---------------------------------------------------------------------------

/** App-wide rule, attempt or not: the wallet never pays for a lookup table again. */
export function assertNoUserFundedAlt(tx: DecodedTransaction | null): void {
  if (tx?.programIds.includes(ALT_PROGRAM_ID)) {
    throw new RelayShieldAbort(
      "USER_FUNDED_ALT_BLOCKED",
      `Refused: the SDK tried to make your wallet sign a lookup-table transaction (${tx.altInstructions.join(" + ") || "Address Lookup Table program"}). Lookup tables are the relay's to create and pay for; nothing was signed or sent.`,
      true
    );
  }
}

function decodeKitTransaction(tx: { messageBytes: Uint8Array; signatures: Record<string, Uint8Array | null> }): DecodedTransaction | null {
  try {
    return decodeTransaction(new Uint8Array(getTransactionEncoder().encode(tx as never)));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The per-attempt guard
// ---------------------------------------------------------------------------

export interface RelayRequestSummary {
  /** Field names of the POST body and their shapes; no values except mint and depositor (public). */
  mint: string | null;
  depositor: string | null;
  nullifiers: number;
  bind0Bytes: number;
}

export interface GuardEvent {
  atMs: number;
  kind: "stage" | "violation" | "relay" | "quote" | "signature";
  detail: string;
}

/**
 * live        the real shield: relay table requested, the wallet signs the deposit, the SDK sends it.
 * dry-run     no relay call (/supplemental-alt is answered locally), no wallet transaction, nothing sent.
 * relay-test  the relay table is requested for real (the relay writes and pays on chain), then the
 *             deposit is only simulated: zero-signature signer, simulate-only transport.
 */
export type RelayGuardMode = "live" | "dry-run" | "relay-test";

export interface RelayShieldReport {
  mode: RelayGuardMode;
  stage: RelayShieldStage;
  violation: RelayShieldViolation | null;
  quote: QuoteInfo | null;
  relayRequest: RelayRequestSummary | null;
  relayTable: string | null;
  relayFailed: string | null;
  signatures: number;
  /** Lookup tables referenced by the transaction the wallet was asked to sign. */
  signedLookupTables: string[];
  events: GuardEvent[];
}

type KitTx = { messageBytes: Uint8Array; signatures: Record<string, Uint8Array | null> };
export interface ModifyingSigner {
  address: string;
  modifyAndSignTransactions(transactions: readonly KitTx[], config?: unknown): Promise<readonly KitTx[]>;
}

/** SDK progress lines that announce the depositor-signed fallback (index.js 0.2.5). */
const FALLBACK_STAGE = /falling back to a depositor-signed table|^Creating address lookup table|Waiting for wallet signature \(lookup table\)|^Creating lookup table/i;

export class RelayShieldGuard {
  private readonly startedAt: number;
  private current: RelayShieldStage = "PREPARING_PROOF";
  private violationKind: RelayShieldViolation | null = null;
  private signed = 0;
  private lookupTablesSigned: string[] = [];
  /** The abort this guard raised, if any (the SDK re-wraps errors, so callers rethrow this one). */
  lastAbort: RelayShieldAbort | null = null;
  quote: QuoteInfo | null = null;
  relayRequest: RelayRequestSummary | null = null;
  relayTable: string | null = null;
  relayFailed: string | null = null;
  readonly events: GuardEvent[] = [];

  constructor(
    private readonly options: {
      mode: RelayGuardMode;
      policy?: FreshnessPolicy;
      now?: () => number;
      onStage?: (stage: RelayShieldStage, detail: string) => void;
    }
  ) {
    this.startedAt = this.now();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private log(kind: GuardEvent["kind"], detail: string) {
    this.events.push({ atMs: this.now() - this.startedAt, kind, detail });
  }

  get stage(): RelayShieldStage {
    return this.current;
  }

  get violation(): RelayShieldViolation | null {
    return this.violationKind;
  }

  private enter(stage: RelayShieldStage, detail = "") {
    this.current = stage;
    this.log("stage", `${stage}${detail ? `: ${detail}` : ""}`);
    this.options.onStage?.(stage, detail);
  }

  private abort(violation: RelayShieldViolation, message: string, beforeBroadcast = true): never {
    this.violationKind ??= violation;
    this.log("violation", `${violation}: ${message}`);
    const error = new RelayShieldAbort(violation, message, beforeBroadcast);
    this.lastAbort ??= error;
    throw error;
  }

  /** Feed every SDK progress line through here first. Throws on the fallback announcement. */
  onProgress(stage: string): void {
    if (FALLBACK_STAGE.test(stage)) {
      this.abort(
        "RELAY_ALT_FALLBACK_BLOCKED",
        `The relay lookup table was not available${this.relayFailed ? ` (${this.relayFailed})` : ""}, and the SDK's fallback (a lookup table paid and signed by your wallet) is disabled. Nothing was signed or sent.`
      );
    }
    if (/^Generating ZK proof|^Computing commitments|^Fetching Merkle proofs/i.test(stage)) this.enter("PREPARING_PROOF", stage);
    else if (/^Fetching risk quote/i.test(stage)) this.enter("FETCHING_RISK_QUOTE");
    else if (/Requesting (supplemental )?lookup table from relay/i.test(stage) && this.current !== "WAITING_FOR_ALT_WARMUP") this.enter("PREPARING_RELAY_ALT");
    else if (/^Sending transaction/i.test(stage)) this.enter("SUBMITTING");
    else if (/^Confirming transaction/i.test(stage)) this.enter("CONFIRMING");
  }

  /** Checks one transaction the wallet is about to sign. */
  inspect(tx: DecodedTransaction | null): void {
    try {
      assertNoUserFundedAlt(tx);
    } catch (error) {
      if (error instanceof RelayShieldAbort) this.abort(error.violation, error.message);
      throw error;
    }
    // A failed relay request alone is not a reason to stop: the deposit may fit without the table (the SDK
    // prefetches it). The fallback itself is what is refused: its progress line and its ALT transaction.
    if (!tx || tx.version !== 0 || !tx.programIds.includes(CLOAK_PROGRAM_ID)) {
      this.abort("UNEXPECTED_TRANSACTION", `Refused to sign: expected a v0 Cloak deposit, got ${tx ? `a ${tx.version} transaction invoking ${tx.programIds.join(", ")}` : "an undecodable transaction"}.`);
    }
    if (this.signed > 0) {
      this.abort(
        "SECOND_SIGNATURE_BLOCKED",
        "The SDK asked for a second wallet signature in the same attempt (its automatic retry). Refused. The first transaction may have been sent: check on chain before anything else.",
        false
      );
    }
  }

  private checkFresh(phase: "prompt" | "send") {
    const f = quoteFreshness(this.quote, this.now(), phase, this.options.policy);
    this.log("quote", `${phase}: ${f.reason}${f.remainingMs !== null ? `, ${Math.round(f.remainingMs / 1000)}s left` : ""}`);
    if (!f.fresh) this.abort("RISK_QUOTE_STALE", `Stopped before ${phase === "prompt" ? "asking your wallet" : "sending"}: the ${f.reason}. Nothing was sent; you can start a new attempt.`);
  }

  /** Transport hook: refuses to forward (or simulate) a lookup-table transaction. */
  inspectSend(tx: DecodedTransaction | null): void {
    try {
      assertNoUserFundedAlt(tx);
    } catch (error) {
      if (error instanceof RelayShieldAbort) this.abort(error.violation, error.message);
      throw error;
    }
  }

  /** Wraps the depositor signer: every check above runs before the wallet is asked, freshness again after it returns. */
  wrapSigner<S extends ModifyingSigner>(inner: S): S {
    const guard = this;
    return {
      ...inner,
      address: inner.address,
      async modifyAndSignTransactions(transactions: readonly KitTx[], config?: unknown) {
        for (const tx of transactions) {
          const decoded = decodeKitTransaction(tx);
          guard.inspect(decoded);
          guard.lookupTablesSigned = decoded?.lookupTables.map((l) => l.table) ?? [];
          if (guard.relayTable && !guard.lookupTablesSigned.includes(guard.relayTable)) {
            guard.log("relay", `the deposit does not reference the relay table ${guard.relayTable} (it fit without it)`);
          }
        }
        guard.enter("CHECKING_QUOTE_FRESHNESS");
        guard.checkFresh("prompt");
        guard.signed += transactions.length;
        guard.enter("WALLET_SIGNATURE_REQUIRED");
        guard.log("signature", "wallet asked to sign the deposit");
        const out = await inner.modifyAndSignTransactions(transactions, config);
        guard.checkFresh("send");
        return out;
      }
    } as S;
  }

  /**
   * Observes the SDK's relay calls (it uses the global fetch). In dry-run
   * mode `/supplemental-alt` is answered here, never sent: requesting the
   * table makes the relay write on chain.
   */
  installFetchObserver(target: { fetch?: typeof fetch }): () => void {
    const original = target.fetch;
    if (!original) return () => undefined;
    const guard = this;
    target.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith(CLOAK_RELAY_ORIGIN)) return original(input, init);
      const path = new URL(url).pathname;
      if (path.endsWith("/supplemental-alt")) {
        guard.recordRelayRequest(init?.body);
        guard.enter("PREPARING_RELAY_ALT");
        if (guard.options.mode === "dry-run") {
          guard.relayFailed = "dry run: the relay table was not requested";
          guard.log("relay", "dry run: /supplemental-alt answered locally, not sent");
          return new Response("dry run: relay supplemental ALT not requested", { status: 503 });
        }
        let response: Response;
        try {
          response = await original(input, init);
        } catch (error) {
          guard.relayFailed = `network error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200);
          throw error;
        }
        if (!response.ok) {
          guard.relayFailed = `HTTP ${response.status}`;
          return response;
        }
        try {
          const body = (await response.clone().json()) as { table?: unknown };
          if (typeof body.table === "string") {
            guard.relayTable = body.table;
            guard.log("relay", `relay table ${body.table}`);
            guard.enter("WAITING_FOR_ALT_WARMUP", body.table);
          }
        } catch {
          /* the SDK reports a malformed body itself */
        }
        return response;
      }
      if (path.endsWith("/range-quote")) {
        const response = await original(input, init);
        if (response.ok) {
          try {
            const body = (await response.clone().json()) as { message?: unknown };
            if (typeof body.message === "string") {
              guard.quote = inspectRangeQuote(body.message, guard.now());
              guard.log("quote", `fetched: ${guard.quote.messageLength}-byte message, expiry ${guard.quote.expiresAtMs === null ? "not found" : `in ${Math.round((guard.quote.expiresAtMs - guard.quote.fetchedAtMs) / 1000)}s`}`);
            }
          } catch {
            /* the SDK validates the quote itself */
          }
        }
        return response;
      }
      return original(input, init);
    }) as typeof fetch;
    return () => {
      target.fetch = original;
    };
  }

  private recordRelayRequest(body: unknown) {
    try {
      const json = JSON.parse(typeof body === "string" ? body : "{}") as { mint?: unknown; depositor?: unknown; nullifiers?: unknown; bind0?: unknown };
      this.relayRequest = {
        mint: typeof json.mint === "string" ? json.mint : null,
        depositor: typeof json.depositor === "string" ? json.depositor : null,
        nullifiers: Array.isArray(json.nullifiers) ? json.nullifiers.length : 0,
        bind0Bytes: typeof json.bind0 === "string" ? json.bind0.length / 2 : 0
      };
    } catch {
      this.relayRequest = { mint: null, depositor: null, nullifiers: 0, bind0Bytes: 0 };
    }
  }

  shielded(): void {
    this.enter("SHIELDED");
  }

  report(): RelayShieldReport {
    return {
      mode: this.options.mode,
      stage: this.current,
      violation: this.violationKind,
      quote: this.quote,
      relayRequest: this.relayRequest,
      relayTable: this.relayTable,
      relayFailed: this.relayFailed,
      signatures: this.signed,
      signedLookupTables: this.lookupTablesSigned,
      events: [...this.events]
    };
  }
}

/**
 * The wallet signer for every Cloak call from this app: during a shield
 * attempt it is the attempt's guard; at any other time it still refuses a
 * lookup-table transaction.
 */
/** Zero-signature modifying signer for dry runs and the relay test: the wallet is never asked. */
export function dryRunModifyingSigner(walletAddress: string): ModifyingSigner {
  return {
    address: walletAddress,
    async modifyAndSignTransactions(transactions) {
      return transactions.map((tx) => ({ ...tx, signatures: { ...tx.signatures, [walletAddress]: new Uint8Array(64) } }));
    }
  };
}

export function guardedWalletSigner<S extends ModifyingSigner>(inner: S, activeGuard: () => RelayShieldGuard | null): S {
  return {
    ...inner,
    address: inner.address,
    async modifyAndSignTransactions(transactions: readonly KitTx[], config?: unknown) {
      const guard = activeGuard();
      if (guard) return guard.wrapSigner(inner).modifyAndSignTransactions(transactions, config);
      for (const tx of transactions) assertNoUserFundedAlt(decodeKitTransaction(tx));
      return inner.modifyAndSignTransactions(transactions, config);
    }
  } as S;
}
