import type { NoteStore, StoredNote } from "@nape3/payments/cloak";

/**
 * Notes in localStorage, encrypted with AES-GCM. The key comes from the
 * wallet's signature over the derivation message (domain-separated from the
 * Cloak seed), so the ciphertext is useless without the wallet and nothing
 * secret is stored in clear.
 */
export class EncryptedLocalNoteStore implements NoteStore {
  private constructor(
    private readonly storageKey: string,
    private readonly key: CryptoKey
  ) {}

  static async create(walletAddress: string, walletSignature: Uint8Array): Promise<EncryptedLocalNoteStore> {
    const material = new Uint8Array([...new TextEncoder().encode("upay3food:notes:v1"), ...walletSignature]);
    const raw = await crypto.subtle.digest("SHA-256", material);
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    return new EncryptedLocalNoteStore(`upay3food.cloak.notes.${walletAddress}`, key);
  }

  async load(): Promise<StoredNote[]> {
    const stored = localStorage.getItem(this.storageKey);
    if (!stored) return [];
    const { iv, data } = JSON.parse(stored) as { iv: string; data: string };
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(iv) }, this.key, b64d(data));
    return (JSON.parse(new TextDecoder().decode(plain)) as { notes: StoredNote[] }).notes;
  }

  async save(notes: StoredNote[]): Promise<void> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, new TextEncoder().encode(JSON.stringify({ notes })));
    localStorage.setItem(this.storageKey, JSON.stringify({ iv: b64e(iv), data: b64e(new Uint8Array(data)) }));
  }
}

function b64e(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64d(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
