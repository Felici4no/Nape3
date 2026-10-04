import { VersionedTransaction } from "@solana/web3.js";
import { address, signerFromWalletAdapter, type Address } from "@cloak.dev/sdk";
import type { CloakSigner } from "@nape3/payments/cloak";

/** Minimal shape of an injected Solana wallet (Phantom, Solflare, Backpack legacy API). */
interface InjectedWallet {
  publicKey: { toBase58(): string } | null;
  isConnected?: boolean;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect?(): Promise<void>;
  signTransaction(tx: unknown): Promise<unknown>;
  signMessage(message: Uint8Array, display?: "utf8" | "hex"): Promise<{ signature: Uint8Array } | Uint8Array>;
}

declare global {
  interface Window {
    phantom?: { solana?: InjectedWallet };
    solflare?: InjectedWallet;
    solana?: InjectedWallet;
  }
}

export function findWallet(): { name: string; wallet: InjectedWallet } | null {
  if (window.phantom?.solana) return { name: "Phantom", wallet: window.phantom.solana };
  if (window.solflare) return { name: "Solflare", wallet: window.solflare };
  if (window.solana) return { name: "Solana wallet", wallet: window.solana };
  return null;
}

export interface ConnectedWallet {
  name: string;
  disconnect(): Promise<void>;
  address: Address;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  cloakSigner(): CloakSigner;
}

/**
 * Connects the injected wallet. `silent` reconnects only if the wallet already
 * trusts this site (no prompt); otherwise it throws and the UI shows "Connect".
 */
export async function connectWallet(options: { silent?: boolean } = {}): Promise<ConnectedWallet> {
  const found = findWallet();
  if (!found) throw new Error("No Solana wallet found. Install Phantom or Solflare and reload.");
  const { publicKey } = options.silent
    ? await found.wallet.connect({ onlyIfTrusted: true })
    : await found.wallet.connect();
  const walletAddress = address(publicKey.toBase58());
  // Raw 64-byte ed25519 signature, as the Cloak relay requires (no re-encoding).
  const signMessage = async (message: Uint8Array) => {
    const result = await found.wallet.signMessage(message, "utf8");
    return result instanceof Uint8Array ? result : result.signature;
  };
  return {
    name: found.name,
    disconnect: async () => {
      await found.wallet.disconnect?.();
    },
    address: walletAddress,
    signMessage,
    cloakSigner: () => ({
      kind: "wallet",
      signer: signerFromWalletAdapter(
        { publicKey: found.wallet.publicKey, signTransaction: (tx) => found.wallet.signTransaction(tx), signMessage },
        { web3: { VersionedTransaction } }
      ),
      signMessage,
      address: walletAddress
    })
  };
}
