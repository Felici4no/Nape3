import { ed25519 } from "@noble/curves/ed25519";
import { address, getAddressEncoder, getTransactionDecoder, getTransactionEncoder, type Address } from "@solana/kit";
import { SOLANA_MAINNET_CHAIN, type StandardAccount, type StandardSignTransactionFeature, type StandardWallet } from "./v1-signing-test";

/**
 * DESIGN (not used by the production shield yet): the smallest wallet signer
 * the Cloak SDK can use for a Transaction V1, without the web3.js
 * `VersionedTransaction` round trip that `signerFromWalletAdapter` does
 * (web3.js 1.99 cannot serialize a v1 message).
 *
 * It has the same shape as the SDK's adapter signer (`address` +
 * `modifyAndSignTransactions`), but passes bytes end to end through the
 * Wallet Standard `solana:signTransaction` feature:
 *
 *   kit transaction ──encode──▶ wire bytes ──wallet──▶ signed wire bytes ──decode──▶ kit transaction
 *
 * The wallet's own representation is used as is: no message is rebuilt and
 * no signature is spliced in by hand. It refuses a result whose message
 * differs from what was asked, or whose signature does not verify for the
 * wallet's key.
 */

type KitTransaction = { messageBytes: Uint8Array; signatures: Record<string, Uint8Array | null> };

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export interface WalletStandardV1Signer {
  address: Address;
  modifyAndSignTransactions<T extends KitTransaction>(transactions: readonly T[]): Promise<T[]>;
}

export function walletStandardV1Signer(wallet: StandardWallet, account: StandardAccount, chain = SOLANA_MAINNET_CHAIN): WalletStandardV1Signer {
  const feature = wallet.features["solana:signTransaction"] as StandardSignTransactionFeature | undefined;
  if (!feature?.signTransaction) throw new Error(`${wallet.name} does not implement solana:signTransaction`);
  const walletAddress = address(account.address);
  const publicKey = new Uint8Array(getAddressEncoder().encode(walletAddress));
  return {
    address: walletAddress,
    async modifyAndSignTransactions(transactions) {
      const out = [];
      for (const transaction of transactions) {
        const wire = new Uint8Array(getTransactionEncoder().encode(transaction as never));
        const [result] = await feature.signTransaction({ account, chain, transaction: wire });
        if (!result?.signedTransaction) throw new Error("the wallet returned no signed transaction");
        const signed = getTransactionDecoder().decode(result.signedTransaction);
        if (!sameBytes(new Uint8Array(signed.messageBytes), transaction.messageBytes)) throw new Error("the wallet changed the transaction message; refusing it");
        const signature = signed.signatures[walletAddress as keyof typeof signed.signatures] as Uint8Array | null | undefined;
        if (!signature || !ed25519.verify(signature, transaction.messageBytes, publicKey)) throw new Error("the wallet's signature does not verify for this message");
        out.push({ ...transaction, messageBytes: transaction.messageBytes, signatures: { ...transaction.signatures, ...signed.signatures } });
      }
      return out;
    }
  };
}
