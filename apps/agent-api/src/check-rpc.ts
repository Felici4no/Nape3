import { isSolanaAddress, rpcFastFromEnv, RpcError, USDC_MINTS } from "@nape3/chain";

/**
 * `pnpm rpc:check [wallet] [signature]` — read-only smoke test of the RPC Fast
 * configuration (RPC_FAST_URL / RPC_FAST_API_KEY) against Solana mainnet:
 * getHealth, genesis hash, getLatestBlockhash, getBalance, USDC token accounts
 * and getTransaction. Never prints the endpoint or the key, and on failure
 * names the stage that broke. Wallet and signature may also come from
 * CHECK_WALLET / CHECK_SIGNATURE.
 */

/** Genesis hash of Solana mainnet-beta. */
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

const provider = rpcFastFromEnv(process.env);
if (!provider) {
  console.error(JSON.stringify({ ok: false, stage: "configuration", error: "RPC_FAST_URL is not set (apps/agent-api/.env or the environment)." }));
  process.exit(1);
}

const secrets = [process.env.RPC_FAST_URL, process.env.RPC_FAST_API_KEY, new URL(process.env.RPC_FAST_URL!).searchParams.get("api_key")].filter((s): s is string => !!s);
/** Strips query strings from URLs and any literal copy of the key. */
function redact(text: string): string {
  let out = text.replace(/(https?|wss?):\/\/[^\s"')]+/g, (u) => u.split("?")[0]!);
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  return out;
}

class StageError extends Error {
  constructor(
    readonly stage: string,
    message: string
  ) {
    super(message);
  }
}

/** Maps a failure to the stage that caused it; `step` names the call that failed. */
function classify(error: unknown, step: string): StageError {
  const message = redact(error instanceof Error ? error.message : String(error));
  if (error instanceof RpcError && error.code === undefined) {
    // network error (Name CODE)
    if (/ENOTFOUND|EAI_AGAIN|EAI_FAIL/.test(message)) return new StageError("DNS", message);
    return new StageError("TLS/connectivity", message);
  }
  if (error instanceof RpcError && (error.code === 401 || error.code === 403)) return new StageError("authentication", message);
  if (error instanceof RpcError && error.code === 429) return new StageError("rate limit", message);
  return new StageError(step, `JSON-RPC error: ${message}`);
}

const timings: Record<string, number> = {};
async function step<T>(name: string, stage: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } catch (error) {
    throw error instanceof StageError ? error : classify(error, stage);
  } finally {
    timings[name] = Date.now() - started;
  }
}

function decimal(units: bigint, decimals: number): string {
  const s = units.toString().padStart(decimals + 1, "0");
  return `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

const wallet = process.argv[2] ?? process.env.CHECK_WALLET ?? USDC_MINTS["mainnet-beta"];
const walletIsDefault = process.argv[2] === undefined && process.env.CHECK_WALLET === undefined;
const started = Date.now();
try {
  if (!isSolanaAddress(wallet)) throw new StageError("invalid wallet", "not a Solana address");

  const health = await step("getHealth", "getHealth", () => provider.request<string>("getHealth"));
  const genesis = await step("getGenesisHash", "getGenesisHash", () => provider.request<string>("getGenesisHash"));
  if (genesis !== MAINNET_GENESIS) throw new StageError("network", "endpoint is not Solana mainnet-beta (genesis hash mismatch)");
  const blockhash = await step("getLatestBlockhash", "getLatestBlockhash", () =>
    provider.request<{ context: { slot: number }; value: { blockhash: string; lastValidBlockHeight: number } }>("getLatestBlockhash", [{ commitment: "confirmed" }])
  );
  const solLamports = await step("getBalance", "getBalance", () => provider.getSolBalance(wallet));
  const usdc = await step("getTokenAccountsByOwner", "token account lookup", () => provider.getTokenBalance(wallet, USDC_MINTS["mainnet-beta"]));

  const signature = await step("getTransaction", "transaction lookup", async () => {
    let sig = process.argv[3] ?? process.env.CHECK_SIGNATURE;
    if (!sig) {
      for (const address of [wallet, USDC_MINTS["mainnet-beta"]]) {
        const list = await provider.request<Array<{ signature: string; err: unknown }>>("getSignaturesForAddress", [address, { limit: 1, commitment: "finalized" }]);
        if (list[0]) {
          sig = list[0].signature;
          break;
        }
      }
    }
    if (!sig) throw new StageError("transaction lookup", "no signature found to look up");
    const tx = await provider.getTransaction(sig, "finalized");
    if (!tx) throw new StageError("transaction lookup", "getTransaction returned null for the signature");
    return { signature: sig, slot: tx.slot, failed: tx.failed };
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        provider: provider.name,
        network: "mainnet-beta",
        health,
        latencyMs: Date.now() - started,
        stepLatencyMs: timings,
        slot: blockhash.context.slot,
        blockhash: blockhash.value.blockhash,
        wallet,
        walletIsDefault,
        solBalance: decimal(solLamports, 9),
        usdcBalance: decimal(usdc, 6),
        transaction: signature,
        keyHeader: process.env.RPC_FAST_API_KEY ? (process.env.RPC_FAST_API_KEY_HEADER ?? "x-api-key") : "none (key in URL)"
      },
      null,
      2
    )
  );
} catch (error) {
  const failure = error instanceof StageError ? error : classify(error, "unknown");
  console.error(JSON.stringify({ ok: false, stage: failure.stage, error: redact(failure.message), stepLatencyMs: timings }, null, 2));
  process.exit(1);
}
