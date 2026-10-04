import { base58Encode, base64Encode } from "./encoding";

/**
 * Solana chain access. The runtime reads chain state and may broadcast
 * transactions the user's wallet already signed; it never holds a signing key.
 *
 * Production: RpcFastProvider (RPC Fast mainnet endpoint). Its URL and key are
 * server-side configuration and must never be shipped to the extension or a
 * public browser bundle. Tests and demos: MockSolanaRpcProvider.
 */

export type Commitment = "confirmed" | "finalized";

export interface TokenBalanceEntry {
  accountIndex: number;
  mint: string;
  owner?: string;
  /** Base units. */
  amount: bigint;
}

/** The parts of a transaction the runtime needs to verify a payment. */
export interface ChainTransaction {
  signature: string;
  slot: number;
  blockTime: number | null;
  failed: boolean;
  error?: string;
  signers: string[];
  preTokenBalances: TokenBalanceEntry[];
  postTokenBalances: TokenBalanceEntry[];
}

export interface SolanaRpcProvider {
  readonly name: string;
  getSolBalance(address: string): Promise<bigint>;
  /** Sum over the owner's token accounts for `mint` (base units). */
  getTokenBalance(address: string, mint: string): Promise<bigint>;
  /** null while the transaction is unknown or not yet at `commitment`. */
  getTransaction(signature: string, commitment?: Commitment): Promise<ChainTransaction | null>;
  /** Broadcasts an already-signed transaction; returns its signature. */
  sendTransaction(rawTx: Uint8Array): Promise<string>;
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number
  ) {
    super(message);
    this.name = "RpcError";
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC over HTTP
// ---------------------------------------------------------------------------

/** Minimal fetch signature, so this package needs neither DOM nor Node typings. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: unknown }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface JsonRpcConfig {
  /** Full endpoint URL. May embed the provider's key: it is never logged or put in errors. */
  url: string;
  /** Optional key sent as a header instead of in the URL. */
  apiKey?: string;
  apiKeyHeader?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
}

interface RpcEnvelope {
  result?: unknown;
  error?: { code?: number; message?: string };
}

interface ParsedTokenAmount {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount?: { amount?: string };
}

const DIGITS = /^\d+$/;

function toEntries(list: unknown): TokenBalanceEntry[] {
  if (!Array.isArray(list)) return [];
  return (list as ParsedTokenAmount[])
    .filter((e) => typeof e.mint === "string" && DIGITS.test(e.uiTokenAmount?.amount ?? ""))
    .map((e) => ({ accountIndex: e.accountIndex, mint: e.mint, ...(e.owner ? { owner: e.owner } : {}), amount: BigInt(e.uiTokenAmount!.amount!) }));
}

/** Generic Solana JSON-RPC provider. */
export class JsonRpcSolanaProvider implements SolanaRpcProvider {
  readonly name: string = "json-rpc";
  private nextId = 1;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly config: JsonRpcConfig) {
    if (!/^https?:\/\//.test(config.url)) throw new RpcError("RPC url must be http(s)");
    this.fetchImpl = config.fetch ?? (globalThis as unknown as { fetch: FetchLike }).fetch;
  }

  protected async call<T>(method: string, params: unknown[]): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.config.apiKey) headers[this.config.apiKeyHeader ?? "x-api-key"] = this.config.apiKey;
    const timeout = (globalThis as unknown as { AbortSignal?: { timeout(ms: number): unknown } }).AbortSignal?.timeout(this.config.timeoutMs ?? 8_000);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(this.config.url, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
        ...(timeout ? { signal: timeout } : {})
      });
    } catch (error) {
      // Never echo the URL: it may carry the API key.
      // The low-level cause code (ENOTFOUND, CERT_*, ...) is safe and tells DNS from TLS from timeout.
      const cause = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
      const detail = [error instanceof Error ? error.name : "unknown", typeof cause === "string" ? cause : null].filter(Boolean).join(" ");
      throw new RpcError(`${this.name} ${method}: network error (${detail})`);
    }
    if (!response.ok) throw new RpcError(`${this.name} ${method}: HTTP ${response.status}`, response.status);
    const envelope = (await response.json()) as RpcEnvelope;
    if (envelope.error) throw new RpcError(`${this.name} ${method}: ${envelope.error.message ?? "error"}`, envelope.error.code);
    return envelope.result as T;
  }

  /** Raw read-only JSON-RPC call, for diagnostics such as `rpc:check`. */
  request<T>(method: string, params: unknown[] = []): Promise<T> {
    return this.call<T>(method, params);
  }

  async getSolBalance(address: string): Promise<bigint> {
    const result = await this.call<{ value: number }>("getBalance", [address, { commitment: "confirmed" }]);
    return BigInt(result.value);
  }

  async getTokenBalance(address: string, mint: string): Promise<bigint> {
    const result = await this.call<{ value: Array<{ account: { data: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }> }>(
      "getTokenAccountsByOwner",
      [address, { mint }, { encoding: "jsonParsed", commitment: "confirmed" }]
    );
    let total = 0n;
    for (const entry of result.value) {
      const amount = entry.account.data.parsed?.info?.tokenAmount?.amount;
      if (typeof amount === "string" && DIGITS.test(amount)) total += BigInt(amount);
    }
    return total;
  }

  async getTransaction(signature: string, commitment: Commitment = "confirmed"): Promise<ChainTransaction | null> {
    const tx = await this.call<{
      slot: number;
      blockTime: number | null;
      meta: { err: unknown; preTokenBalances?: unknown; postTokenBalances?: unknown } | null;
      transaction: { message: { accountKeys: Array<{ pubkey: string; signer: boolean } | string> } };
    } | null>("getTransaction", [signature, { encoding: "jsonParsed", commitment, maxSupportedTransactionVersion: 1 }]);
    if (!tx) return null;
    const keys = tx.transaction.message.accountKeys;
    return {
      signature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      failed: tx.meta?.err != null,
      ...(tx.meta?.err != null ? { error: JSON.stringify(tx.meta.err) } : {}),
      signers: keys.filter((k): k is { pubkey: string; signer: boolean } => typeof k !== "string" && k.signer).map((k) => k.pubkey),
      preTokenBalances: toEntries(tx.meta?.preTokenBalances),
      postTokenBalances: toEntries(tx.meta?.postTokenBalances)
    };
  }

  async sendTransaction(rawTx: Uint8Array): Promise<string> {
    return this.call<string>("sendTransaction", [base64Encode(rawTx), { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 3 }]);
  }
}

/**
 * RPC Fast (https://rpcfast.com) Solana endpoint, the production/mainnet RPC.
 * Configure on the server only:
 *   RPC_FAST_URL      endpoint URL as issued by the RPC Fast dashboard
 *   RPC_FAST_API_KEY  optional, when the key is sent as a header (RPC_FAST_API_KEY_HEADER, default x-api-key)
 * The exact key placement depends on the plan; check the dashboard. The key
 * never reaches the extension or the web bundle: the browser asks agent-api.
 */
export class RpcFastProvider extends JsonRpcSolanaProvider {
  override readonly name = "rpc-fast";
}

export function rpcFastFromEnv(env: Record<string, string | undefined>, fetchImpl?: FetchLike): RpcFastProvider | null {
  if (!env.RPC_FAST_URL) return null;
  return new RpcFastProvider({
    url: env.RPC_FAST_URL,
    ...(env.RPC_FAST_API_KEY ? { apiKey: env.RPC_FAST_API_KEY } : {}),
    ...(env.RPC_FAST_API_KEY_HEADER ? { apiKeyHeader: env.RPC_FAST_API_KEY_HEADER } : {}),
    ...(fetchImpl ? { fetch: fetchImpl } : {})
  });
}

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

/** Deterministic in-memory chain for tests and the simulated demo. */
export class MockSolanaRpcProvider implements SolanaRpcProvider {
  readonly name = "mock";
  private readonly sol = new Map<string, bigint>();
  private readonly tokens = new Map<string, bigint>();
  private readonly txs = new Map<string, ChainTransaction>();
  readonly sent: Uint8Array[] = [];
  /** When set, getTransaction returns null for this many calls (simulates confirmation latency). */
  pendingReads = 0;

  setSol(address: string, lamports: bigint): this {
    this.sol.set(address, lamports);
    return this;
  }

  setToken(address: string, mint: string, amount: bigint): this {
    this.tokens.set(`${address}:${mint}`, amount);
    return this;
  }

  addTransaction(tx: ChainTransaction): this {
    this.txs.set(tx.signature, tx);
    return this;
  }

  async getSolBalance(address: string): Promise<bigint> {
    return this.sol.get(address) ?? 0n;
  }

  async getTokenBalance(address: string, mint: string): Promise<bigint> {
    return this.tokens.get(`${address}:${mint}`) ?? 0n;
  }

  async getTransaction(signature: string): Promise<ChainTransaction | null> {
    if (this.pendingReads > 0) {
      this.pendingReads -= 1;
      return null;
    }
    return this.txs.get(signature) ?? null;
  }

  async sendTransaction(rawTx: Uint8Array): Promise<string> {
    if (rawTx.length === 0) throw new RpcError("empty transaction");
    this.sent.push(rawTx);
    // A signed transaction starts with its signatures: [count][sig 64 bytes]…
    return base58Encode(rawTx.slice(1, 65));
  }
}
