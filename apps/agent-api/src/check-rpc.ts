import { isSolanaAddress, readWalletBalances, rpcFastFromEnv, USDC_MINTS } from "@nape3/chain";

/**
 * `pnpm rpc:check [address]` — verifies the RPC Fast configuration
 * (RPC_FAST_URL / RPC_FAST_API_KEY) with two read-only calls. Never prints
 * the endpoint or the key.
 */
const provider = rpcFastFromEnv(process.env);
if (!provider) {
  console.error("RPC_FAST_URL is not set (apps/agent-api/.env or the environment).");
  process.exit(1);
}
// Default: Circle's USDC mint authority wallet is not needed; any public address works. Use the USDC mint account itself.
const address = process.argv[2] ?? USDC_MINTS["mainnet-beta"];
if (!isSolanaAddress(address)) {
  console.error("not a Solana address");
  process.exit(1);
}
const started = Date.now();
try {
  const balances = await readWalletBalances(provider, address, USDC_MINTS["mainnet-beta"]);
  console.log(
    JSON.stringify({
      ok: true,
      provider: balances.provider,
      address,
      solLamports: balances.solLamports.toString(),
      publicUsdc: balances.publicUsdc.toString(),
      latencyMs: Date.now() - started,
      keyHeader: process.env.RPC_FAST_API_KEY ? (process.env.RPC_FAST_API_KEY_HEADER ?? "x-api-key") : "none (key in URL)"
    })
  );
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
}
