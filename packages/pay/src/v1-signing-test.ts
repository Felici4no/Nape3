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
 * "Can this wallet sign a Transaction V1?" without risking anything.
 *
 * The wallet is asked to sign (signTransaction only) a harmless v1 message:
 * the wallet pays the fee of a 0-lamport System transfer to itself. The
 * signed result is checked locally (same message bytes, still version 1, a
 * valid ed25519 signature of those bytes by the connected key) and then
 * discarded. It is never sent: while the test runs, a guard makes every
 * broadcast path we can reach throw (JSON-RPC send methods over fetch/XHR,
 * the wallet's sign-and-send methods). Nothing is logged or stored.
 */

export const SYSTEM_PROGRAM_ADDRESS = "11111111111111111111111111111111";

export type V1SigningOutcome = "PHANTOM_V1_SIGNING_SUPPORTED" | "PHANTOM_V1_SIGNING_UNSUPPORTED" | "INCONCLUSIVE_USER_REJECTED";

export interface V1SigningResult {
  outcome: V1SigningOutcome;
  detail: string;
  wallet: string;
  /**
   * How the wallet was asked: "sdk-adapter" = exactly what the Cloak SDK does
   * (a web3.js VersionedTransaction to `signTransaction`); "raw-bytes" = the
   * provider's `request({ method: "signTransaction" })` with the serialized
   * bytes, used only when the first path failed inside this page before
   * reaching the wallet.
   */
  path: "sdk-adapter" | "raw-bytes" | null;
  /** Errors on the sdk-adapter path that happened in this page, not in the wallet. */
  inPageErrors: string[];
  /**
   * Whether the Cloak SDK's own adapter could use the wallet's result
   * (it calls `signed.serialize()`); null when the wallet did not sign.
   */
  sdkAdapterPathWorks: boolean | null;
  checks: {
    /** The wallet returned without throwing. */
    walletReturned: boolean;
    /** Returned message bytes are byte-identical to what was built. */
    messageUnchanged: boolean | null;
    /** Returned message still decodes as version 1. */
    stillVersion1: boolean | null;
    /** The fee payer's signature verifies over the message with the connected public key. */
    signatureValid: boolean | null;
  };
  /** Broadcast attempts the guard blocked during the test (expected 0). */
  blockedBroadcasts: number;
}

export interface SigningWallet {
  publicKey: { toBase58(): string } | null;
  signTransaction(tx: unknown): Promise<unknown>;
  /** Provider request API (Phantom): used only for `signTransaction` with raw bytes. */
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
  XMLHttpRequest?: { prototype: { open: (...a: never[]) => unknown; send: (body?: unknown) => unknown } };
}

/**
 * Installs the guard and returns its restore function. `request` (the
 * EIP-1193-style provider entry) is guarded only for its send methods.
 */
export function installBroadcastGuard(target: GuardTarget, wallet: object, onBlocked: () => void): () => void {
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
  return { wire: new Uint8Array(getTransactionEncoder().encode(transaction)), messageBytes: new Uint8Array(transaction.messageBytes) };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function isUserRejection(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  return e?.code === 4001 || /reject|denied|cancel/i.test(String(e?.message ?? ""));
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https?:\/\/\S+/g, "[url]").slice(0, 300);
}

interface SignedView {
  /** Fee payer's signature. */
  signature: Uint8Array;
  /** Message bytes as returned, when they can be read (web3.js 1.99 cannot re-serialize a v1 message). */
  messageBytes: Uint8Array | null;
  version: unknown;
}

/** Pulls the fee payer's signature (and, when possible, the message bytes) out of whatever the wallet returned. */
function readSigned(signed: unknown, wallet: string): SignedView | null {
  let bytes: Uint8Array | null = null;
  if (signed instanceof Uint8Array) bytes = signed;
  else if (typeof signed === "string") bytes = new Uint8Array(getBase58Encoder().encode(signed));
  else if (signed && typeof signed === "object") {
    const o = signed as { transaction?: unknown; signedTransaction?: unknown; signature?: unknown; signatures?: unknown; message?: { serialize?: () => Uint8Array; version?: unknown }; version?: unknown };
    const inner = o.signedTransaction ?? o.transaction;
    if (typeof inner === "string" || inner instanceof Uint8Array) return readSigned(inner, wallet);
    if (Array.isArray(o.signatures) && o.signatures[0] instanceof Uint8Array) {
      let messageBytes: Uint8Array | null = null;
      try {
        messageBytes = o.message?.serialize?.() ?? null;
      } catch {
        messageBytes = null;
      }
      return { signature: o.signatures[0], messageBytes, version: o.version ?? o.message?.version };
    }
    if (typeof o.signature === "string") return { signature: new Uint8Array(getBase58Encoder().encode(o.signature)), messageBytes: null, version: null };
    if (o.signature instanceof Uint8Array) return { signature: o.signature, messageBytes: null, version: null };
  }
  if (!bytes) return null;
  const tx = getTransactionDecoder().decode(bytes);
  const signature = tx.signatures[wallet as keyof typeof tx.signatures] as Uint8Array | null | undefined;
  return { signature: signature ? new Uint8Array(signature) : new Uint8Array(64), messageBytes: new Uint8Array(tx.messageBytes), version: null };
}

/** What the Cloak SDK does with the wallet's result: `signed.serialize()`. */
function sdkPathSerializes(signed: unknown): { ok: boolean; error: string | null } {
  const s = (signed as { serialize?: () => Uint8Array } | null)?.serialize;
  if (typeof s !== "function") return { ok: false, error: "the wallet's result has no serialize()" };
  try {
    const out = s.call(signed);
    out.fill?.(0);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: shortError(error) };
  }
}

const WEB3_V1_SERIALIZE = /Serialization of version 1 transaction messages is not supported/;

export interface V1SigningTestDeps {
  wallet: SigningWallet;
  latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: bigint | number }>;
  /** Where fetch/XMLHttpRequest live (globalThis in the browser). */
  guardTarget?: GuardTarget;
  /** The real provider object, whose sign-and-send methods are disabled during the test (defaults to `wallet`). */
  guardWallet?: object;
}

export async function runV1SigningTest(deps: V1SigningTestDeps): Promise<V1SigningResult> {
  const walletAddress = deps.wallet.publicKey?.toBase58();
  if (!walletAddress) throw new Error("connect the wallet first");
  const checks: V1SigningResult["checks"] = { walletReturned: false, messageUnchanged: null, stillVersion1: null, signatureValid: null };
  const inPageErrors: string[] = [];
  let blockedBroadcasts = 0;
  let path: V1SigningResult["path"] = null;
  let sdkAdapterPathWorks: boolean | null = null;
  const result = (outcome: V1SigningOutcome, detail: string): V1SigningResult => ({
    outcome,
    detail,
    wallet: walletAddress,
    path,
    inPageErrors,
    sdkAdapterPathWorks,
    checks,
    blockedBroadcasts
  });

  const { blockhash, lastValidBlockHeight } = await deps.latestBlockhash();
  let built: { wire: Uint8Array; messageBytes: Uint8Array } | null = buildHarmlessV1(walletAddress, blockhash, BigInt(lastValidBlockHeight));
  let signed: unknown = null;
  let view: SignedView | null = null;
  const restore = installBroadcastGuard(deps.guardTarget ?? (globalThis as unknown as GuardTarget), deps.guardWallet ?? deps.wallet, () => blockedBroadcasts++);
  try {
    // 1) Exactly the Cloak SDK's path: web3.js VersionedTransaction → wallet.signTransaction.
    path = "sdk-adapter";
    let failure: unknown = null;
    try {
      const unsigned = VersionedTransaction.deserialize(built.wire);
      signed = await deps.wallet.signTransaction(unsigned);
    } catch (error) {
      failure = error;
    }
    if (failure !== null) {
      if (failure instanceof BroadcastBlockedError) throw failure;
      if (isUserRejection(failure)) return result("INCONCLUSIVE_USER_REJECTED", "the signature request was rejected in the wallet; no conclusion about v1 support");
      if (!WEB3_V1_SERIALIZE.test(shortError(failure)) || !deps.wallet.request) {
        return result("PHANTOM_V1_SIGNING_UNSUPPORTED", `the wallet refused to sign the v1 transaction: ${shortError(failure)}`);
      }
      // The provider tried to re-serialize the web3.js object in this page (web3.js 1.99 cannot
      // serialize v1), so the wallet never saw it. Ask again with the bytes themselves.
      inPageErrors.push(`sdk-adapter path: ${shortError(failure)}`);
      sdkAdapterPathWorks = false;
      path = "raw-bytes";
      try {
        signed = await deps.wallet.request({ method: "signTransaction", params: { message: getBase58Decoder().decode(built.wire) } });
      } catch (error) {
        if (error instanceof BroadcastBlockedError) throw error;
        if (isUserRejection(error)) return result("INCONCLUSIVE_USER_REJECTED", "the signature request was rejected in the wallet; no conclusion about v1 support");
        return result("PHANTOM_V1_SIGNING_UNSUPPORTED", `the wallet refused to sign the v1 transaction bytes: ${shortError(error)}`);
      }
    }
    checks.walletReturned = true;
    if (path === "sdk-adapter") {
      const serialized = sdkPathSerializes(signed);
      sdkAdapterPathWorks = serialized.ok;
      if (serialized.error) inPageErrors.push(`signed.serialize() (what the Cloak SDK calls next): ${serialized.error}`);
    }
    try {
      view = readSigned(signed, walletAddress);
    } catch (error) {
      return result("PHANTOM_V1_SIGNING_UNSUPPORTED", `the wallet's signed result could not be read back: ${shortError(error)}`);
    }
    if (!view) return result("PHANTOM_V1_SIGNING_UNSUPPORTED", "the wallet returned something that is not a signed transaction");

    const publicKey = new Uint8Array(getAddressEncoder().encode(address(walletAddress)));
    // A valid ed25519 signature over the bytes built here proves the wallet signed exactly this message.
    checks.signatureValid = view.signature.length === 64 && view.signature.some((b) => b !== 0) && ed25519.verify(view.signature, built.messageBytes, publicKey);
    if (view.messageBytes) {
      checks.messageUnchanged = sameBytes(view.messageBytes, built.messageBytes);
      try {
        checks.stillVersion1 = (getCompiledTransactionMessageDecoder().decode(view.messageBytes) as { version: unknown }).version === 1;
      } catch {
        checks.stillVersion1 = false;
      }
    } else {
      checks.messageUnchanged = checks.signatureValid ? true : null;
      checks.stillVersion1 = view.version === null || view.version === undefined ? (checks.signatureValid ? true : null) : view.version === 1;
    }

    if (checks.stillVersion1 === false) return result("PHANTOM_V1_SIGNING_UNSUPPORTED", "the wallet returned a message that is no longer Transaction V1");
    if (checks.messageUnchanged === false) return result("PHANTOM_V1_SIGNING_UNSUPPORTED", "the wallet changed the v1 message (the result is not the transaction built here)");
    if (!checks.signatureValid) return result("PHANTOM_V1_SIGNING_UNSUPPORTED", "the wallet's signature does not verify for this v1 message and the connected public key");
    const caveat =
      sdkAdapterPathWorks === false
        ? " The Cloak SDK's own wallet path would still fail in this app (web3.js cannot re-serialize v1), so a v1 shield needs an adapter that passes raw bytes."
        : "";
    return result("PHANTOM_V1_SIGNING_SUPPORTED", `the wallet signed the unchanged v1 message; the signature verifies with the connected public key. It was discarded, not sent.${caveat}`);
  } finally {
    restore();
    // Discard: overwrite what we hold of the signed transaction and drop the references.
    view?.signature.fill(0);
    const sigs = (signed as { signatures?: Uint8Array[] } | null)?.signatures;
    if (Array.isArray(sigs)) for (const s of sigs) if (s instanceof Uint8Array) s.fill(0);
    if (signed instanceof Uint8Array) signed.fill(0);
    signed = null;
    view = null;
    built = null;
  }
}
