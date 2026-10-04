import {
  computeUtxoCommitment,
  computeUtxoNullifier,
  createRecoverableDepositUtxo,
  createUtxo,
  createZeroUtxo,
  deserializeUtxo,
  serializeUtxo,
  type TransactResult,
  type Utxo
} from "@cloak.dev/sdk";
import type { CloakSdkPort } from "./port";

/**
 * SIMULATED Cloak SDK for tests and the dry-run demo. Note creation,
 * serialization and commitments use the real @cloak.dev/sdk functions; only
 * the network side (proof submission, relay, chain) is faked in memory.
 * Signatures start with "SIMULATED" so they can never be mistaken for real ones.
 */
export function createSimulatedCloakSdk(options: { firstLeafIndex?: number } = {}) {
  let nextLeaf = options.firstLeafIndex ?? 1000;
  let counter = 0;
  const spentNullifiers = new Set<bigint>();
  const submitted: Array<{ kind: "deposit" | "withdraw"; externalAmount: bigint; recipient?: string }> = [];

  const signature = () => `SIMULATED${(++counter).toString().padStart(6, "0")}${Date.now().toString(36)}`;

  async function place(outputs: Utxo[]): Promise<Utxo[]> {
    const padded = [...outputs];
    while (padded.length < 2) padded.push(await createZeroUtxo(outputs[0]?.mintAddress));
    const placed: Utxo[] = [];
    for (const utxo of padded) placed.push({ ...utxo, index: nextLeaf++, commitment: await computeUtxoCommitment(utxo) });
    placed[0]!.siblingCommitment = placed[1]!.commitment;
    placed[1]!.siblingCommitment = placed[0]!.commitment;
    return placed;
  }

  async function spend(inputs: Utxo[]): Promise<bigint[]> {
    const nullifiers: bigint[] = [];
    for (const input of inputs) {
      if (input.amount === 0n) continue;
      const nullifier = await computeUtxoNullifier(input);
      if (spentNullifiers.has(nullifier)) throw new Error("UtxoAlreadySpent (simulated)");
      nullifiers.push(nullifier);
    }
    nullifiers.forEach((n) => spentNullifiers.add(n));
    return nullifiers;
  }

  function result(outputs: Utxo[], inputNullifiers: bigint[]): TransactResult {
    return {
      signature: signature(),
      inputNullifiers,
      outputCommitments: outputs.map((o) => o.commitment!),
      newRoot: "simulated",
      commitmentIndices: [outputs[0]!.index!, outputs[1]!.index!],
      siblingCommitments: [outputs[1]!.commitment!, outputs[0]!.commitment!],
      outputUtxos: outputs
    } as unknown as TransactResult;
  }

  const sdk: CloakSdkPort = {
    createRecoverableDepositUtxo,
    createZeroUtxo,
    serializeUtxo,
    deserializeUtxo,
    computeUtxoCommitment,
    async transact(params) {
      const external = params.externalAmount ?? 0n;
      const inputNullifiers = await spend(params.inputUtxos);
      const outputs = await place(params.outputUtxos);
      submitted.push({ kind: external > 0n ? "deposit" : "withdraw", externalAmount: external });
      return result(outputs, inputNullifiers);
    },
    async partialWithdraw(inputs, recipient, amount) {
      const total = inputs.reduce((sum, u) => sum + u.amount, 0n);
      if (amount > total) throw new Error("withdraw amount exceeds inputs (simulated)");
      const inputNullifiers = await spend(inputs);
      const change = await createUtxo(total - amount, inputs[0]!.keypair, inputs[0]!.mintAddress);
      const outputs = await place([change]);
      submitted.push({ kind: "withdraw", externalAmount: -amount, recipient });
      return result(outputs, inputNullifiers);
    },
    async verifyUtxos(utxos) {
      const spent: Utxo[] = [];
      const unspent: Utxo[] = [];
      for (const utxo of utxos) {
        (spentNullifiers.has(await computeUtxoNullifier(utxo)) ? spent : unspent).push(utxo);
      }
      return { spent, unspent, skipped: [] };
    }
  };
  return { sdk, submitted };
}
