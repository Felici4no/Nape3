import { VersionedTransaction } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash
} from "@solana/kit";

/**
 * Two independent compatibility questions, answered without risking anything:
 *
 *   A. Can the wallet (Phantom) sign a Transaction V1 message?
 *   B. Can the Cloak SDK's current wallet adapter consume the result?
 *
 * B is answered locally, with no wallet prompt: the SDK's
 * `signerFromWalletAdapter` hands the wallet a web3.js `VersionedTransaction`
 * and calls `signed.serialize()` on the result, and web3.js 1.99 cannot
 * serialize a v1 message.
 *
 * A asks the wallet to sign (sign only, never sign-and-send) a harmless v1
 * message: the wallet pays the fee of a 0-lamport System transfer to itself.
 * Two documented byte-level routes are tried, in order:
 *   1. Wallet Standard `solana:signTransaction` with the serialized
 *      transaction bytes (the wallet also declares its supported versions);
 *   2. the injected provider's `request({ method: "signTransaction",
 *      params: { message: base58(serializeMessage()) } })`, as in Phantom's
 *      docs: the MESSAGE bytes, not the full wire transaction.
 * Whatever comes back is described by shape only (key names, types,
 * lengths), checked locally (ed25519 over the message built here with the
 * connected key) and discarded. While the test runs, a guard makes every
 * broadcast path we can reach throw. Nothing is logged or stored.
 */

export const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111";
export const SOLANA_MAINNET_CHAIN = "solana:mainnet";

export type V1SigningOutcome =
  | "PHANTOM_V1_SIGNING_SUPPORTED"
  | "PHANTOM_V1_SIGNING_UNSUPPORTED"
  /** Our request may not match what the wallet expects: no conclusion about v1. */
  | "DIAGNOSTIC_REQUEST_INVALID"
  | "INCONCLUSIVE_USER_REJECTED";

export type SigningPath = "wallet-standard" | "provider-request";

export interface SigningChecks {
  /** Returned message bytes are byte-identical to what was built (true also when only a valid signature came back). */
  messageUnchanged: boolean | null;
  stillVersion1: boolean | null;
  /** The fee payer's signature verifies over the message built here with the connected public key. */
  signatureValid: boolean | null;
}

export interface SigningAttempt {
  path: SigningPath;
  /** What was sent to the wallet (encoding only, no bytes). */
  request: string;
  outcome: V1SigningOutcome;
  detail: string;
  /** The wallet's error, if it threw (URLs stripped). */
  error: string | null;
  /** Shape of what the wallet returned: key names, types and lengths, never values. */
  responseShape: string | null;
  checks: SigningChecks;
}

export interface StandardWalletInfo {
  found: boolean;
  name: string | null;
  /** `solana:signTransaction.supportedTransactionVersions` as the wallet declares it. */
  signTransactionVersions: Array<string | number> | null;
  declaresV1: boolean | null;
}

export interface V1SigningResult {
  wallet: string;
  /** Question A. */
  phantomV1: V1SigningOutcome;
  phantomV1Support: "YES" | "NO" | "UNKNOWN";
  /** Question B (no wallet prompt). */
  cloakAdapter: { works: boolean; reason: string };
  detail: string;
  walletStandard: StandardWalletInfo;
  attempts: SigningAttempt[];
  /** Broadcast attempts the guard blocked during the test (expected 0). */
  blockedBroadcasts: number;
}

/** Minimal Wallet Standard shapes (https://github.com/wallet-standard/wallet-standard). */
export interface StandardAccount {
  address: string;
  publicKey?: Uint8Array;
  chains?: readonly string[];
  features?: readonly string[];
}

export interface StandardSignTransactionFeature {
  version?: string;
  supportedTransactionVersions?: ReadonlyArray<string | number>;
  signTransaction(
    ...inputs: Array<{
      account: StandardAccount;
      transaction: Uint8Array;
      chain?: string;
    }>
  ): Promise<ReadonlyArray<{ signedTransaction: Uint8Array }>>;
}

export interface StandardWallet {
  name: string;
  accounts: readonly StandardAccount[];
  chains?: readonly string[];
  features: Record<string, unknown>;
}

export interface ProviderLike {
  request?(args: { method: string; params?: unknown }): Promise<unknown>;
}

export class BroadcastBlockedError extends Error {
  constructor(what: string) {
    super(`Blocked: ${what}. The Transaction V1 signing test never broadcasts.`);
    this.name = "BroadcastBlockedError";
  }
}

const SEND_METHODS = /"method"\s*:\s*"(sendTransaction|sendRawTransaction|sendBundle|sendTransactionWithConfig)"/;
const WALLET_SEND_METHODS = ["signAndSendTransaction", "signAndSendAllTransactions", "sendTransaction", "request"] as const;

function bodyText(body: unknown): string {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body));
  return "";
}

function isBroadcastRequest(url: string, body: unknown): string | null {
  if (SEND_METHODS.test(bodyText(body))) return "a JSON-RPC send method";
  if (/relay|\/submit|\/transact/i.test(url)) return `a request to ${url.replace(/\?.*$/, "")}`;
  return null;
}

interface GuardTarget {
  fetch?: typeof fetch;
  XMLHttpRequest?: {
    prototype: {
      open: (...a: never[]) => unknown;
      send: (body?: unknown) => unknown;
    };
  };
}

/**
 * Installs the guard and returns its restore function. `request` (the
 * EIP-1193-style provider entry) is guarded only for its send methods.
 */
export function installBroadcastGuard(target: GuardTarget, wallets: object | object[], onBlocked: () => void): () => void {
  const restores: Array<() => void> = [];
  const block = (what: string): never => {
    onBlocked();
    throw new BroadcastBlockedError(what);
  };

  const originalFetch = target.fetch;
  if (originalFetch) {
    target.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const reason = isBroadcastRequest(url, init?.body);
      if (reason) {
        try {
          block(reason);
        } catch (error) {
          return Promise.reject(error);
        }
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    restores.push(() => {
      target.fetch = originalFetch;
    });
  }

  const xhr = target.XMLHttpRequest?.prototype;
  if (xhr) {
    const open = xhr.open;
    const send = xhr.send;
    const urls = new WeakMap<object, string>();
    xhr.open = function (this: object, ...args: never[]) {
      urls.set(this, String(args[1] ?? ""));
      return (open as (...a: never[]) => unknown).apply(this, args);
    };
    xhr.send = function (this: object, body?: unknown) {
      const reason = isBroadcastRequest(urls.get(this) ?? "", body);
      if (reason) block(reason);
      return send.call(this, body);
    };
    restores.push(() => {
      xhr.open = open;
      xhr.send = send;
    });
  }

  for (const wallet of Array.isArray(wallets) ? wallets : [wallets]) {
    const w = wallet as Record<string, unknown>;
    for (const name of WALLET_SEND_METHODS) {
      const original = w[name];
      if (typeof original !== "function") continue;
      const guarded =
        name === "request"
          ? function (this: unknown, args: { method?: string } | undefined) {
              if (args?.method && /send/i.test(args.method)) block(`wallet.request(${args.method})`);
              return (original as (a: unknown) => unknown).call(this ?? wallet, args);
            }
          : () => block(`wallet.${name}`);
      try {
        w[name] = guarded;
        if (w[name] === guarded) restores.push(() => void (w[name] = original));
      } catch {
        // A frozen provider keeps its method; the test itself never calls it.
      }
    }
  }

  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

/** The harmless message: fee payer = wallet, System transfer of 0 lamports from the wallet to itself. */
export function buildHarmlessV1(wallet: string, blockhash: string, lastValidBlockHeight: bigint): { wire: Uint8Array; messageBytes: Uint8Array } {
  const payer = address(wallet);
  const data = new Uint8Array(12); // u32 tag 2 (Transfer) + u64 lamports 0
  data[0] = 2;
  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (m) => setTransactionMessageFeePayer(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash as Blockhash, lastValidBlockHeight }, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          {
            programAddress: address(SYSTEM_PROGRAM_ADDRESS),
            accounts: [
              { address: payer, role: AccountRole.WRITABLE_SIGNER },
              { address: payer, role: AccountRole.WRITABLE_SIGNER }
            ],
            data
          }
        ],
        m
      )
  );
  const transaction = compileTransaction(message as Parameters<typeof compileTransaction>[0]);
  return {
    wire: new Uint8Array(getTransactionEncoder().encode(transaction)),
    messageBytes: new Uint8Array(transaction.messageBytes)
  };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function isUserRejection(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  return e?.code === 4001 || /user rejected|rejected the request|denied|cancel/i.test(String(e?.message ?? ""));
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String((error as { message?: unknown } | null)?.message ?? error);
  return message.replace(/https?:\/\/\S+/g, "[url]").slice(0, 300);
}

/** An error that says, in so many words, that the version is not supported. */
const EXPLICIT_VERSION_REFUSAL = /(unsupported|not supported|unknown).{0,40}version|version.{0,40}(unsupported|not supported)/i;

/**
 * Shape of a wallet response for the report: types, key names and lengths
 * only. Never values (a signed transaction or signature is never printed).
 */
export function describeShape(value: unknown, depth = 0): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (value instanceof Uint8Array) return `Uint8Array(${value.length})`;
  if (value instanceof ArrayBuffer) return `ArrayBuffer(${value.byteLength})`;
  if (typeof value === "string") {
    let decoded = "";
    try {
      decoded = `, base58→${getBase58Encoder().encode(value).length} bytes`;
    } catch {
      decoded = "";
    }
    return `string(${value.length}${decoded})`;
  }
  if (typeof value !== "object") return typeof value;
  if (depth >= 3) return "object";
  if (Array.isArray(value))
    return `[${value
      .slice(0, 4)
      .map((v) => describeShape(v, depth + 1))
      .join(", ")}${value.length > 4 ? ", …" : ""}]`;
  const ctor = (value as object).constructor?.name;
  const keys = Object.keys(value as object).slice(0, 12);
  const fns = ["serialize", "serializeMessage"].filter((k) => typeof (value as Record<string, unknown>)[k] === "function");
  const body = keys.map((k) => `${k}: ${describeShape((value as Record<string, unknown>)[k], depth + 1)}`);
  return `${ctor && ctor !== "Object" ? ctor : "object"}{${[...body, ...fns.map((f) => `${f}()`)].join(", ")}}`;
}

interface SignedView {
  signature: Uint8Array;
  /** Message bytes as returned, when the response carries a full transaction. */
  messageBytes: Uint8Array | null;
}

function bytesOf(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") {
    try {
      return new Uint8Array(getBase58Encoder().encode(value));
    } catch {
      return null;
    }
  }
  return null;
}

function fromBytes(bytes: Uint8Array, wallet: string): SignedView {
  if (bytes.length === 64) return { signature: bytes, messageBytes: null };
  const tx = getTransactionDecoder().decode(bytes);
  const sig = tx.signatures[wallet as keyof typeof tx.signatures] as Uint8Array | null | undefined;
  return {
    signature: sig ? new Uint8Array(sig) : new Uint8Array(64),
    messageBytes: new Uint8Array(tx.messageBytes)
  };
}

/**
 * Reads the fee payer's signature out of the shapes wallets are known to
 * return: raw/base58 bytes of a signed transaction or of a 64-byte signature,
 * `{ signature, publicKey }`, `{ signedTransaction | transaction }`, or a
 * transaction object with `signatures[0]`.
 */
export function readSigned(response: unknown, wallet: string): SignedView | null {
  const direct = bytesOf(response);
  if (direct) return fromBytes(direct, wallet);
  if (!response || typeof response !== "object") return null;
  const o = response as Record<string, unknown>;
  if (typeof o.publicKey === "string" && o.publicKey !== wallet) throw new Error("the response is signed by a different public key");
  for (const key of ["signedTransaction", "transaction"]) {
    const b = bytesOf(o[key]);
    if (b) return fromBytes(b, wallet);
  }
  const sig = bytesOf(o.signature);
  if (sig) return { signature: sig, messageBytes: null };
  const sigs = o.signatures;
  if (Array.isArray(sigs) && sigs[0] instanceof Uint8Array) {
    let messageBytes: Uint8Array | null = null;
    try {
      messageBytes = (o.message as { serialize?: () => Uint8Array } | undefined)?.serialize?.() ?? null;
    } catch {
      messageBytes = null;
    }
    return { signature: sigs[0], messageBytes };
  }
  return null;
}

function check(view: SignedView, built: { messageBytes: Uint8Array }, wallet: string): SigningChecks {
  const publicKey = new Uint8Array(getAddressEncoder().encode(address(wallet)));
  const signatureValid = view.signature.length === 64 && view.signature.some((b) => b !== 0) && ed25519.verify(view.signature, built.messageBytes, publicKey);
  if (!view.messageBytes)
    return {
      signatureValid,
      messageUnchanged: signatureValid ? true : null,
      stillVersion1: signatureValid ? true : null
    };
  let stillVersion1 = false;
  try {
    stillVersion1 =
      (
        getCompiledTransactionMessageDecoder().decode(view.messageBytes) as {
          version: unknown;
        }
      ).version === 1;
  } catch {
    stillVersion1 = false;
  }
  return {
    signatureValid,
    messageUnchanged: sameBytes(view.messageBytes, built.messageBytes),
    stillVersion1
  };
}

function verdict(checks: SigningChecks): {
  outcome: V1SigningOutcome;
  detail: string;
} {
  if (checks.stillVersion1 === false)
    return {
      outcome: "PHANTOM_V1_SIGNING_UNSUPPORTED",
      detail: "the wallet returned a message that is no longer Transaction V1"
    };
  if (checks.messageUnchanged === false)
    return {
      outcome: "PHANTOM_V1_SIGNING_UNSUPPORTED",
      detail: "the wallet changed the v1 message (the result is not the transaction built here)"
    };
  if (!checks.signatureValid)
    return {
      outcome: "PHANTOM_V1_SIGNING_UNSUPPORTED",
      detail: "the wallet's signature does not verify for this v1 message and the connected public key"
    };
  return {
    outcome: "PHANTOM_V1_SIGNING_SUPPORTED",
    detail: "the wallet signed the unchanged v1 message; the signature verifies with the connected public key"
  };
}

/** Overwrites every byte array reachable in a wallet response (signatures, signed transactions). */
function wipe(value: unknown, depth = 0): void {
  if (depth > 3 || value === null || typeof value !== "object") return;
  if (value instanceof Uint8Array) {
    value.fill(0);
    return;
  }
  for (const v of Array.isArray(value) ? value : Object.values(value as object)) wipe(v, depth + 1);
}

/**
 * Wallet Standard discovery (the protocol's app-ready handshake), synchronous:
 * wallets listening for `wallet-standard:app-ready` register right away.
 */
export function discoverStandardWallets(target: Pick<EventTarget, "addEventListener" | "removeEventListener" | "dispatchEvent">): StandardWallet[] {
  const wallets: StandardWallet[] = [];
  const api = Object.freeze({
    register: (...ws: StandardWallet[]) => {
      wallets.push(...ws);
      return () => undefined;
    }
  });
  const onRegister = (event: Event) => {
    try {
      (event as CustomEvent<(a: typeof api) => void>).detail(api);
    } catch {
      // a wallet that fails to register is simply not found
    }
  };
  target.addEventListener("wallet-standard:register-wallet", onRegister);
  try {
    target.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));
  } finally {
    target.removeEventListener("wallet-standard:register-wallet", onRegister);
  }
  return wallets;
}

export function pickStandardWallet(wallets: readonly StandardWallet[], walletAddress: string, preferredName = "Phantom"): StandardWallet | null {
  const capable = wallets.filter(
    (w) => w.features && typeof (w.features["solana:signTransaction"] as StandardSignTransactionFeature | undefined)?.signTransaction === "function"
  );
  return (
    capable.find((w) => w.name === preferredName && w.accounts.some((a) => a.address === walletAddress)) ??
    capable.find((w) => w.name === preferredName) ??
    capable.find((w) => w.accounts.some((a) => a.address === walletAddress)) ??
    null
  );
}

/** Question B, locally: does the Cloak SDK's web3.js-based adapter survive a v1 transaction? */
export function cloakAdapterCheck(wire: Uint8Array): {
  works: boolean;
  reason: string;
} {
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(wire);
  } catch (error) {
    return {
      works: false,
      reason: `web3.js cannot load the v1 transaction: ${shortError(error)}`
    };
  }
  try {
    tx.serialize().fill(0);
    return {
      works: true,
      reason: "web3.js can load and re-serialize the v1 transaction"
    };
  } catch (error) {
    return {
      works: false,
      reason: `web3.js loads the v1 transaction but its serialize() throws (${shortError(error)}); the SDK's signerFromWalletAdapter needs it twice: the wallet provider serializes the VersionedTransaction it is given, and the SDK calls signed.serialize() on the result`
    };
  }
}

export interface V1SigningTestDeps {
  walletAddress: string;
  latestBlockhash(): Promise<{
    blockhash: string;
    lastValidBlockHeight: bigint | number;
  }>;
  /** Wallet Standard wallets (discoverStandardWallets(window) in the browser). */
  standardWallets?: () => StandardWallet[];
  /** The injected provider (window.phantom.solana), for `request({ method: "signTransaction" })`. */
  provider?: ProviderLike | null;
  /** Where fetch/XMLHttpRequest live (globalThis in the browser). */
  guardTarget?: GuardTarget;
}

async function attemptWalletStandard(
  wallet: StandardWallet,
  walletAddress: string,
  built: { wire: Uint8Array; messageBytes: Uint8Array },
  declaresV1: boolean | null
): Promise<SigningAttempt> {
  const feature = wallet.features["solana:signTransaction"] as StandardSignTransactionFeature;
  const request = "Wallet Standard solana:signTransaction { account, chain: solana:mainnet, transaction: serialized v1 transaction bytes }";
  const base = {
    path: "wallet-standard" as const,
    request,
    error: null,
    responseShape: null,
    checks: {
      messageUnchanged: null,
      stillVersion1: null,
      signatureValid: null
    }
  };
  let account = wallet.accounts.find((a) => a.address === walletAddress);
  if (!account) {
    const connect = wallet.features["standard:connect"] as
      | {
          connect?: (input?: { silent?: boolean }) => Promise<{ accounts: readonly StandardAccount[] }>;
        }
      | undefined;
    try {
      const out = await connect?.connect?.({ silent: true });
      account = out?.accounts.find((a) => a.address === walletAddress) ?? wallet.accounts.find((a) => a.address === walletAddress);
    } catch {
      account = undefined;
    }
  }
  if (!account)
    return {
      ...base,
      outcome: "DIAGNOSTIC_REQUEST_INVALID",
      detail: "the Wallet Standard wallet does not expose the connected account (not asked to sign)"
    };
  let response: unknown = null;
  try {
    response = await feature.signTransaction({
      account,
      chain: SOLANA_MAINNET_CHAIN,
      transaction: new Uint8Array(built.wire)
    });
  } catch (error) {
    if (error instanceof BroadcastBlockedError) throw error;
    const message = shortError(error);
    if (isUserRejection(error))
      return {
        ...base,
        error: message,
        outcome: "INCONCLUSIVE_USER_REJECTED",
        detail: "rejected in the wallet; no conclusion about v1"
      };
    // The input format is the standard's own (transaction bytes), so a refusal is the wallet's answer.
    return {
      ...base,
      error: message,
      outcome: "PHANTOM_V1_SIGNING_UNSUPPORTED",
      detail: `the wallet refused the v1 transaction over Wallet Standard${declaresV1 === false ? " (its declared supported versions do not include 1)" : ""}`
    };
  }
  try {
    const responseShape = describeShape(response);
    const first = Array.isArray(response) ? response[0] : response;
    const view = readSigned(first, walletAddress);
    if (!view)
      return {
        ...base,
        responseShape,
        outcome: "DIAGNOSTIC_REQUEST_INVALID",
        detail: "the wallet returned a shape this diagnostic cannot read (see responseShape)"
      };
    const checks = check(view, built, walletAddress);
    view.signature.fill(0);
    return { ...base, responseShape, checks, ...verdict(checks) };
  } catch (error) {
    return {
      ...base,
      responseShape: describeShape(response),
      outcome: "DIAGNOSTIC_REQUEST_INVALID",
      detail: `could not read the wallet's response: ${shortError(error)}`
    };
  } finally {
    wipe(response);
  }
}

async function attemptProviderRequest(
  provider: ProviderLike,
  walletAddress: string,
  built: { wire: Uint8Array; messageBytes: Uint8Array }
): Promise<SigningAttempt> {
  const request = 'provider.request({ method: "signTransaction", params: { message: base58(v1 message bytes) } }) (Phantom docs: base58(serializeMessage()))';
  const base = {
    path: "provider-request" as const,
    request,
    error: null,
    responseShape: null,
    checks: {
      messageUnchanged: null,
      stillVersion1: null,
      signatureValid: null
    }
  };
  let response: unknown = null;
  try {
    response = await provider.request!({
      method: "signTransaction",
      params: { message: getBase58Decoder().decode(built.messageBytes) }
    });
  } catch (error) {
    if (error instanceof BroadcastBlockedError) throw error;
    const message = shortError(error);
    if (isUserRejection(error))
      return {
        ...base,
        error: message,
        outcome: "INCONCLUSIVE_USER_REJECTED",
        detail: "rejected in the wallet; no conclusion about v1"
      };
    if (EXPLICIT_VERSION_REFUSAL.test(message))
      return {
        ...base,
        error: message,
        outcome: "PHANTOM_V1_SIGNING_UNSUPPORTED",
        detail: "the wallet says the transaction version is not supported"
      };
    // Parse failures ("Reached end of buffer unexpectedly", …) can mean our encoding is not what this
    // undocumented-for-v1 entry point expects: no conclusion about v1.
    return {
      ...base,
      error: message,
      outcome: "DIAGNOSTIC_REQUEST_INVALID",
      detail: "the wallet could not use the request as sent; this does not show whether it supports v1"
    };
  }
  try {
    const responseShape = describeShape(response);
    const view = readSigned(response, walletAddress);
    if (!view)
      return {
        ...base,
        responseShape,
        outcome: "DIAGNOSTIC_REQUEST_INVALID",
        detail: "the wallet returned a shape this diagnostic cannot read (see responseShape)"
      };
    const checks = check(view, built, walletAddress);
    view.signature.fill(0);
    return { ...base, responseShape, checks, ...verdict(checks) };
  } catch (error) {
    return {
      ...base,
      responseShape: describeShape(response),
      outcome: "DIAGNOSTIC_REQUEST_INVALID",
      detail: `could not read the wallet's response: ${shortError(error)}`
    };
  } finally {
    wipe(response);
  }
}

const PRIORITY: V1SigningOutcome[] = [
  "PHANTOM_V1_SIGNING_SUPPORTED",
  "INCONCLUSIVE_USER_REJECTED",
  "PHANTOM_V1_SIGNING_UNSUPPORTED",
  "DIAGNOSTIC_REQUEST_INVALID"
];

export async function runV1SigningTest(deps: V1SigningTestDeps): Promise<V1SigningResult> {
  const walletAddress = deps.walletAddress;
  const { blockhash, lastValidBlockHeight } = await deps.latestBlockhash();
  let built: { wire: Uint8Array; messageBytes: Uint8Array } | null = buildHarmlessV1(walletAddress, blockhash, BigInt(lastValidBlockHeight));
  const cloakAdapter = cloakAdapterCheck(built.wire);

  const standard = pickStandardWallet(deps.standardWallets?.() ?? [], walletAddress);
  const versions = (standard?.features["solana:signTransaction"] as StandardSignTransactionFeature | undefined)?.supportedTransactionVersions ?? null;
  const walletStandard: StandardWalletInfo = {
    found: !!standard,
    name: standard?.name ?? null,
    signTransactionVersions: versions ? [...versions] : null,
    declaresV1: versions ? versions.some((v) => v === 1 || v === "1") : null
  };

  let blockedBroadcasts = 0;
  const guarded: object[] = [];
  if (deps.provider) guarded.push(deps.provider);
  const signAndSend = standard?.features["solana:signAndSendTransaction"];
  if (signAndSend && typeof signAndSend === "object") guarded.push(signAndSend);
  const restore = installBroadcastGuard(deps.guardTarget ?? (globalThis as unknown as GuardTarget), guarded, () => blockedBroadcasts++);
  const attempts: SigningAttempt[] = [];
  try {
    if (standard) attempts.push(await attemptWalletStandard(standard, walletAddress, built, walletStandard.declaresV1));
    const last = attempts.at(-1)?.outcome;
    if (last !== "PHANTOM_V1_SIGNING_SUPPORTED" && last !== "INCONCLUSIVE_USER_REJECTED" && deps.provider?.request) {
      attempts.push(await attemptProviderRequest(deps.provider, walletAddress, built));
    }
  } finally {
    restore();
    built = null;
  }

  const phantomV1 = attempts.length ? PRIORITY.find((o) => attempts.some((a) => a.outcome === o))! : "DIAGNOSTIC_REQUEST_INVALID";
  const phantomV1Support = phantomV1 === "PHANTOM_V1_SIGNING_SUPPORTED" ? "YES" : phantomV1 === "PHANTOM_V1_SIGNING_UNSUPPORTED" ? "NO" : "UNKNOWN";
  const decisive = attempts.find((a) => a.outcome === phantomV1);
  const detail = attempts.length
    ? `${decisive!.path}: ${decisive!.detail}. Phantom V1 support: ${phantomV1Support}. Current Cloak/web3.js adapter: ${cloakAdapter.works ? "YES" : "NO"}.`
    : "no byte-level signing route was available (no Wallet Standard wallet with solana:signTransaction, no provider.request)";
  return {
    wallet: walletAddress,
    phantomV1,
    phantomV1Support,
    cloakAdapter,
    detail,
    walletStandard,
    attempts,
    blockedBroadcasts
  };
}
