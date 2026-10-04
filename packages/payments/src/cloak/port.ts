import {
  computeUtxoCommitment,
  CLOAK_PRODUCTION_RELAY_URL,
  CLOAK_PROGRAM_ID,
  createRecoverableDepositUtxo,
  createZeroUtxo,
  deserializeUtxo,
  partialWithdraw,
  serializeUtxo,
  transact,
  verifyUtxos,
  type Address,
  type CloakRpc,
  type KeyPairSigner,
  type TransactOptions,
  type TransactionSigner,
  type Utxo
} from "@cloak.dev/sdk";

/**
 * The subset of @cloak.dev/sdk the funding layer uses. Production binds the
 * real SDK (`realCloakSdk`); tests bind a fake with the same shapes.
 */
export interface CloakSdkPort {
  transact: typeof transact;
  partialWithdraw: typeof partialWithdraw;
  createRecoverableDepositUtxo: typeof createRecoverableDepositUtxo;
  createZeroUtxo: typeof createZeroUtxo;
  serializeUtxo: typeof serializeUtxo;
  deserializeUtxo: typeof deserializeUtxo;
  verifyUtxos: typeof verifyUtxos;
  computeUtxoCommitment: typeof computeUtxoCommitment;
}

export const realCloakSdk: CloakSdkPort = {
  transact,
  partialWithdraw,
  createRecoverableDepositUtxo,
  createZeroUtxo,
  serializeUtxo,
  deserializeUtxo,
  verifyUtxos,
  computeUtxoCommitment
};

/**
 * Who signs. Scripts use a local keypair file; apps use the user's wallet
 * (signer + signMessage). Both name the SAME end user — the SDK screens and
 * authenticates that one address.
 */
export type CloakSigner =
  | { kind: "keypair"; keypair: KeyPairSigner }
  | {
      kind: "wallet";
      signer: TransactionSigner;
      signMessage: (message: Uint8Array) => Promise<Uint8Array>;
      address: Address;
    };

export function signerAddress(signer: CloakSigner): Address {
  return signer.kind === "keypair" ? signer.keypair.address : signer.address;
}

/** Mainnet options: program id and relay are fixed constants, never user input. */
export function cloakOptions(
  connection: CloakRpc,
  signer: CloakSigner,
  nk: Uint8Array,
  extra: Partial<TransactOptions> = {}
): TransactOptions {
  const base: TransactOptions = {
    connection,
    programId: CLOAK_PROGRAM_ID,
    relayUrl: CLOAK_PRODUCTION_RELAY_URL,
    chainNoteViewingKeyNk: nk,
    ...extra
  };
  if (signer.kind === "keypair") {
    return { ...base, depositorKeypair: signer.keypair, walletPublicKey: signer.keypair.address };
  }
  return {
    ...base,
    signer: signer.signer,
    signMessage: signer.signMessage,
    depositorPublicKey: signer.address,
    walletPublicKey: signer.address
  };
}

export type { Utxo };
