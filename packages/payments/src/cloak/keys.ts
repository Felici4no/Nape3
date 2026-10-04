import {
  deriveSpendKey,
  deriveUtxoKeypairFromSpendKey,
  deriveViewingKeyFromNk,
  expandSpendKey,
  type UtxoKeypair
} from "@cloak.dev/sdk";

/**
 * Cloak key material for one user. Secrets live only in memory inside
 * `CloakKeys`; serializing or inspecting the object yields "[redacted]" so a
 * stray console.log / JSON.stringify cannot leak the spend key, the viewing
 * key (nk) or the note key pair.
 */

/** Message the wallet signs to derive the Cloak seed. Signing it authorizes nothing on-chain. */
export const CLOAK_KEY_DERIVATION_MESSAGE =
  "UPAY3FOOD.agent: derive my Cloak shielded key (v1).\n" +
  "This signature stays on this device. It does not authorize any transaction.";

const REDACTED = "[redacted]";
const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

export class CloakKeys {
  readonly #skSpend: Uint8Array;
  readonly #nk: Uint8Array;
  readonly #utxoKeypair: UtxoKeypair;
  /** X25519 public viewing key — safe to share (lets others deliver notes to you). */
  readonly viewingPublicKeyHex: string;

  private constructor(skSpend: Uint8Array, nk: Uint8Array, utxoKeypair: UtxoKeypair, viewingPublicKey: Uint8Array) {
    this.#skSpend = skSpend;
    this.#nk = nk;
    this.#utxoKeypair = utxoKeypair;
    this.viewingPublicKeyHex = Array.from(viewingPublicKey, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  static async fromSeed(seed: Uint8Array): Promise<CloakKeys> {
    if (seed.length !== 32) throw new Error("Cloak seed must be 32 bytes");
    const { sk_spend } = deriveSpendKey(seed);
    const { nsk } = expandSpendKey(sk_spend);
    const utxoKeypair = await deriveUtxoKeypairFromSpendKey(sk_spend);
    return new CloakKeys(sk_spend, nsk, utxoKeypair, deriveViewingKeyFromNk(nsk).publicKey);
  }

  /** Viewing base. Pass to the SDK only; never log, upload or display. */
  viewingKeyNk(): Uint8Array {
    return this.#nk;
  }

  utxoKeypair(): UtxoKeypair {
    return this.#utxoKeypair;
  }

  spendKey(): Uint8Array {
    return this.#skSpend;
  }

  toJSON(): string {
    return REDACTED;
  }

  toString(): string {
    return REDACTED;
  }

  [inspectSymbol](): string {
    return "CloakKeys [redacted]";
  }
}

/**
 * Deterministic seed from the wallet's signature over
 * CLOAK_KEY_DERIVATION_MESSAGE (ed25519 signatures are deterministic), so the
 * same wallet always re-derives the same shielded keys and nothing secret has
 * to be stored.
 */
export async function seedFromWalletSignature(signature: Uint8Array): Promise<Uint8Array> {
  if (signature.length !== 64) throw new Error("expected a 64-byte ed25519 signature");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(signature));
  return new Uint8Array(digest);
}

export function derivationMessageBytes(): Uint8Array {
  return new TextEncoder().encode(CLOAK_KEY_DERIVATION_MESSAGE);
}
