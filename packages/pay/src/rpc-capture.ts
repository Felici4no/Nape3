import type { CloakRpc } from "@cloak.dev/sdk";
import { diagnosticFromRpcError, type RpcFailureDiagnostic } from "@nape3/payments/cloak";
import { createDefaultRpcTransport, createSolanaRpcFromTransport, type RpcTransport, type TransactionPartialSigner, type Address } from "@solana/kit";

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
  diagnostic: RpcFailureDiagnostic;
}

export interface CaptureHooks {
  onFailure?(diagnostic: RpcFailureDiagnostic, method: string): void;
  onSimulation?(outcome: SimulationOutcome): void;
}

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
      const simulation = (await base({
        ...config,
        payload: {
          jsonrpc: "2.0",
          id: payload.id,
          method: "simulateTransaction",
          params: [wire, { encoding: options?.encoding ?? "base64", sigVerify: false, replaceRecentBlockhash: false, commitment: options?.preflightCommitment ?? "confirmed" }]
        }
      })) as JsonRpcResponse;
      if (simulation.error) {
        hooks.onSimulation?.({ ok: false, diagnostic: diagnosticFromRpcError(simulation.error) });
      } else {
        const value = ((simulation.result as { value?: Record<string, unknown> } | undefined)?.value ?? {}) as Record<string, unknown>;
        const ok = value.err === null || value.err === undefined;
        hooks.onSimulation?.({
          ok,
          diagnostic: diagnosticFromRpcError({ code: ok ? 0 : -32002, message: ok ? "Simulation succeeded (not broadcast)" : "Transaction simulation failed (not broadcast)", data: value })
        });
      }
      return { jsonrpc: "2.0", id: payload.id, error: { code: DRY_RUN_ERROR_CODE, message: DRY_RUN_MESSAGE } };
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
