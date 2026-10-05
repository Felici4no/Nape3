import type { CloakRpc } from "@cloak.dev/sdk";
import { diagnosticFromRpcError, type RpcFailureDiagnostic } from "@nape3/payments/cloak";
import { base64ToBytes, decodeTransaction, type DecodedTransaction } from "./tx-decode";
import { shieldCost, systemMovements, type InnerInstruction, type ShieldCost, type SystemMovement } from "./shield-cost";
import {
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  getBase64Decoder,
  getTransactionDecoder,
  type RpcTransport,
  type TransactionPartialSigner,
  type Address
} from "@solana/kit";

/**
 * RPC client for /shield that keeps what the Cloak SDK throws away.
 *
 * live           requests pass through unchanged; a `sendTransaction` or
 *                `simulateTransaction` error response is recorded as a
 *                structured diagnostic (code, message, err, logs,
 *                unitsConsumed, …) before the SDK re-wraps it.
 * simulate-only  `sendTransaction` is never forwarded: the same wire bytes go
 *                to `simulateTransaction` (sigVerify off) and the SDK receives
 *                an error, so nothing can be broadcast.
 *
 * Only responses are recorded. Request params (the signed transaction) are
 * never stored, logged or retried.
 */

export type CaptureMode = "live" | "simulate-only";

export interface SimulationOutcome {
  ok: boolean;
  /** The RPC refused to simulate (JSON-RPC error: unsupported version, too large…); the program never ran. */
  rpcRejected: boolean;
  diagnostic: RpcFailureDiagnostic;
  /** Public summary of the simulated transaction (programs, lookup tables); null if it could not be decoded. */
  transaction: DecodedTransaction | null;
  /** SOL requirement measured around the simulation (when `measureCost` is on); null if it could not be measured. */
  cost?: ShieldCost | null;
  /** Why the cost could not be measured. */
  costError?: string;
}

function decodeWire(wire: unknown, encoding: string | undefined): DecodedTransaction | null {
  if (typeof wire !== "string" || (encoding ?? "base64") !== "base64") return null;
  try {
    return decodeTransaction(base64ToBytes(wire));
  } catch {
    return null;
  }
}

export interface CaptureHooks {
  onFailure?(diagnostic: RpcFailureDiagnostic, method: string): void;
  onSimulation?(outcome: SimulationOutcome): void;
  /**
   * simulate-only: also ask the simulation for the post-state of every
   * writable account and its inner instructions, read the same accounts' current
   * balances, the cluster fee for the exact message and the payer's rent-exempt
   * minimum, and attach a SOL cost breakdown. Reads only.
   */
  measureCost?: boolean;
  /**
   * live: called with every transaction before `sendTransaction` is
   * forwarded. Throwing refuses the send: the RPC never receives it and the
   * SDK gets a JSON-RPC error (BLOCKED_SEND_ERROR_CODE).
   */
  inspectSend?(transaction: DecodedTransaction | null): void;
}

/** Error code returned to the SDK when `inspectSend` refuses a transaction. */
export const BLOCKED_SEND_ERROR_CODE = -32098;

/** Error code returned to the SDK in simulate-only mode (outside the Solana-reserved range it decodes). */
export const DRY_RUN_ERROR_CODE = -32099;
export const DRY_RUN_MESSAGE = "dry run: transaction simulated, not broadcast";

interface JsonRpcPayload {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: unknown[];
}

interface JsonRpcResponse {
  id?: unknown;
  result?: unknown;
  error?: { code?: unknown; message?: unknown; data?: unknown };
}

type BaseTransport = (config: { payload: unknown; signal?: AbortSignal }) => Promise<unknown>;

/** The transport wrapper, independent of the HTTP layer (unit-tested with a fake). */
export function captureTransport(base: BaseTransport, mode: CaptureMode, hooks: CaptureHooks): BaseTransport {
  return async (config) => {
    const payload = config.payload as JsonRpcPayload;
    const method = payload?.method ?? "";

    if (mode === "simulate-only" && method === "sendTransaction") {
      const [wire, options] = (payload.params ?? []) as [string, { encoding?: string; preflightCommitment?: string } | undefined];
      const transaction = decodeWire(wire, options?.encoding);
      if (hooks.inspectSend) {
        try {
          hooks.inspectSend(transaction);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { jsonrpc: "2.0", id: payload.id, error: { code: BLOCKED_SEND_ERROR_CODE, message: `blocked before simulating: ${message}` } };
        }
      }
      const commitment = options?.preflightCommitment ?? "confirmed";
      const measure = !!hooks.measureCost && transaction !== null && transaction.writableKeys.length > 0;
      const simulateOptions: Record<string, unknown> = { encoding: options?.encoding ?? "base64", sigVerify: false, replaceRecentBlockhash: false, commitment };
      if (measure) {
        simulateOptions.accounts = { addresses: transaction.writableKeys, encoding: "base64" };
        simulateOptions.innerInstructions = true;
      }
      const simulation = (await base({ ...config, payload: { jsonrpc: "2.0", id: payload.id, method: "simulateTransaction", params: [wire, simulateOptions] } })) as JsonRpcResponse;
      if (simulation.error) {
        hooks.onSimulation?.({ ok: false, rpcRejected: true, diagnostic: diagnosticFromRpcError(simulation.error), transaction });
      } else {
        const value = ((simulation.result as { value?: Record<string, unknown> } | undefined)?.value ?? {}) as Record<string, unknown>;
        const ok = value.err === null || value.err === undefined;
        // The diagnostic keeps what it always had; post-state accounts can be large and are summarized by the cost instead.
        const { accounts: postAccounts, innerInstructions, ...diagnosticData } = value;
        const outcome: SimulationOutcome = {
          ok,
          rpcRejected: false,
          diagnostic: diagnosticFromRpcError({ code: ok ? 0 : -32002, message: ok ? "Simulation succeeded (not broadcast)" : "Transaction simulation failed (not broadcast)", data: { ...diagnosticData, accounts: null } }),
          transaction
        };
        if (measure) {
          try {
            outcome.cost = await measureCost(base, config.signal, wire, transaction, postAccounts, innerInstructions, commitment);
          } catch (error) {
            outcome.cost = null;
            outcome.costError = error instanceof Error ? error.message : String(error);
          }
        }
        hooks.onSimulation?.(outcome);
      }
      return { jsonrpc: "2.0", id: payload.id, error: { code: DRY_RUN_ERROR_CODE, message: DRY_RUN_MESSAGE } };
    }

    if (method === "sendTransaction" && hooks.inspectSend) {
      const [wire, options] = (payload.params ?? []) as [string, { encoding?: string } | undefined];
      try {
        hooks.inspectSend(decodeWire(wire, options?.encoding));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { jsonrpc: "2.0", id: payload.id, error: { code: BLOCKED_SEND_ERROR_CODE, message: `blocked before sending: ${message}` } };
      }
    }

    const response = (await base(config)) as JsonRpcResponse;
    if (response?.error && (method === "sendTransaction" || method === "simulateTransaction")) {
      hooks.onFailure?.(diagnosticFromRpcError(response.error), method);
    }
    if (method === "simulateTransaction" && response?.result) {
      const value = (response.result as { value?: Record<string, unknown> }).value;
      if (value && value.err !== null && value.err !== undefined) {
        hooks.onFailure?.(diagnosticFromRpcError({ code: -32002, message: "Transaction simulation failed", data: value }), method);
      }
    }
    return response;
  };
}

let readId = 0;

async function read<T>(base: BaseTransport, signal: AbortSignal | undefined, method: string, params: unknown[]): Promise<T> {
  const response = (await base({ ...(signal ? { signal } : {}), payload: { jsonrpc: "2.0", id: `cost-${++readId}`, method, params } })) as JsonRpcResponse;
  if (response.error) throw new Error(`${method}: ${String(response.error.message ?? response.error.code)}`);
  return response.result as T;
}

function lamportsOf(account: unknown): bigint | null {
  if (!account || typeof account !== "object") return null;
  const l = (account as { lamports?: unknown }).lamports;
  return typeof l === "number" || typeof l === "bigint" ? BigInt(l) : null;
}

interface UiInner {
  index: number;
  instructions: Array<InnerInstruction | { programId: string; parsed?: { type?: string; info?: Record<string, unknown> } }>;
}

/** Inner System createAccount/transfer from either compiled or parsed simulation output. */
function movementsFrom(inner: unknown, accountKeys: string[], before: Map<string, bigint | null>): SystemMovement[] {
  if (!Array.isArray(inner)) return [];
  const compiled: InnerInstruction[] = [];
  const parsed: SystemMovement[] = [];
  for (const group of inner as UiInner[]) {
    for (const ix of group.instructions ?? []) {
      if ("programIdIndex" in ix) compiled.push(ix);
      else if (ix.programId === "11111111111111111111111111111111" && ix.parsed?.info) {
        const info = ix.parsed.info;
        const to = String(info.newAccount ?? info.destination ?? "?");
        const lamports = BigInt(String(info.lamports ?? 0));
        const existed = (before.get(to) ?? null) !== null;
        if (ix.parsed.type === "createAccount") {
          parsed.push({ kind: "createAccount", from: String(info.source), to, lamports, space: BigInt(String(info.space ?? 0)), owner: String(info.owner ?? ""), toExistedBefore: existed });
        } else if (ix.parsed.type === "transfer") {
          parsed.push({ kind: "transfer", from: String(info.source), to, lamports, toExistedBefore: existed });
        }
      }
    }
  }
  return [...systemMovements(compiled, accountKeys, before), ...parsed];
}

/** RPC Fast caps getMultipleAccounts at 5 addresses per call. */
export const GET_MULTIPLE_ACCOUNTS_MAX = 5;

/**
 * Reads `keys` in batches of at most GET_MULTIPLE_ACCOUNTS_MAX (sequentially,
 * read-only, no retries) and returns one entry per key, in the original order
 * (duplicates included).
 */
export async function readAccountsBatched(base: BaseTransport, signal: AbortSignal | undefined, keys: readonly string[], commitment: string): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let i = 0; i < keys.length; i += GET_MULTIPLE_ACCOUNTS_MAX) {
    const chunk = keys.slice(i, i + GET_MULTIPLE_ACCOUNTS_MAX);
    const r = await read<{ value: unknown[] }>(base, signal, "getMultipleAccounts", [chunk, { encoding: "base64", dataSlice: { offset: 0, length: 0 }, commitment }]);
    if (!Array.isArray(r.value) || r.value.length !== chunk.length) throw new Error(`getMultipleAccounts returned ${Array.isArray(r.value) ? r.value.length : "no"} entries for ${chunk.length} addresses`);
    out.push(...r.value);
  }
  return out;
}

async function measureCost(
  base: BaseTransport,
  signal: AbortSignal | undefined,
  wire: string,
  transaction: DecodedTransaction,
  postAccounts: unknown,
  inner: unknown,
  commitment: string
): Promise<ShieldCost> {
  const keys = transaction.writableKeys;
  const messageBase64 = getBase64Decoder().decode(getTransactionDecoder().decode(base64ToBytes(wire)).messageBytes);
  const [pre, fee, rentMin] = await Promise.all([
    readAccountsBatched(base, signal, keys, commitment),
    read<{ value: number | null }>(base, signal, "getFeeForMessage", [messageBase64, { commitment }]).catch(() => ({ value: null })),
    read<number>(base, signal, "getMinimumBalanceForRentExemption", [0, { commitment }])
  ]);
  const post = Array.isArray(postAccounts) ? postAccounts : [];
  const accounts = keys.map((address, i) => ({ address, before: lamportsOf(pre[i]), after: lamportsOf(post[i]) }));
  const before = new Map(accounts.map((a) => [a.address, a.before] as const));
  return shieldCost({
    feePayer: transaction.staticKeys[0]!,
    accounts,
    movements: movementsFrom(inner, transaction.staticKeys, before),
    networkFee: fee.value === null || fee.value === undefined ? null : BigInt(fee.value),
    priorityFee: transaction.priorityFeeLamports,
    payerRentExemptMinimum: BigInt(rentMin)
  });
}

/** Same shape as the SDK's `createCloakRpc` (an `endpoint` property the SDK checks), with capture. */
export function createCapturingCloakRpc(url: string, mode: CaptureMode, hooks: CaptureHooks): CloakRpc {
  const base = createDefaultRpcTransport({ url }) as unknown as BaseTransport;
  const rpc = createSolanaRpcFromTransport(captureTransport(base, mode, hooks) as unknown as RpcTransport);
  return new Proxy(rpc, {
    get(target, prop, receiver) {
      if (prop === "endpoint") return url;
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      return prop === "endpoint" || Reflect.has(target, prop);
    }
  }) as unknown as CloakRpc;
}

/**
 * Signer for simulate-only runs: signs nothing, returns an all-zero signature
 * for the wallet. The wallet is never asked to sign a transaction, and the
 * result could not be valid on chain even if it were sent.
 */
export function dryRunSigner(walletAddress: Address): TransactionPartialSigner {
  return {
    address: walletAddress,
    signTransactions: async (transactions) => transactions.map(() => ({ [walletAddress]: new Uint8Array(64) }) as never)
  };
}
