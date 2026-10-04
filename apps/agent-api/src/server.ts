import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { MockSolanaRpcProvider, rpcFastFromEnv, USDC_MINTS } from "@nape3/chain";
import { DemoMarket, ObserverMarket, OfframpFunding, SimulatedSettlement } from "./adapters";
import { createApp, RunEventBus } from "./app";
import { SimulatedExecutor } from "./demo/simulated-executor";
import { Orchestrator } from "./orchestrator";
import type { ChainPort, MarketPort } from "./ports";
import { MemoryRunStore } from "./store/memory";
import { migrate, PostgresRunStore, type SqlClient } from "./store/postgres";
import type { RunStore } from "./store/types";

/**
 * Environment:
 *   PORT                 default 8788
 *   AGENT_STORE          "pglite" (default, persistent local Postgres in AGENT_DATA_DIR) | "memory" | "postgres" (DATABASE_URL, needs `pg`)
 *   OBSERVER_API_URL     live market (real observations); without it the synthetic demo market is used, labelled
 *   OBSERVER_READ_TOKEN
 *   RPC_FAST_URL         Solana mainnet RPC (RPC Fast). Server-side only. + RPC_FAST_API_KEY[_HEADER]
 *   DEMO_EXECUTOR=1      run the simulated browser executor (demo market only)
 *   WEB_ORIGIN           extra CORS origin(s), comma-separated
 * Settlement stays simulated: no licensed off-ramp is integrated.
 */

const env = process.env;
const log = (entry: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), scope: "agent-api", ...entry }));

async function openStore(): Promise<RunStore> {
  const kind = env.AGENT_STORE ?? "pglite";
  if (kind === "memory") return new MemoryRunStore();
  if (kind === "postgres") {
    if (!env.DATABASE_URL) throw new Error("AGENT_STORE=postgres requires DATABASE_URL");
    const moduleName = "pg";
    const pg = (await import(moduleName)) as { default: { Pool: new (o: { connectionString: string }) => never } };
    const { pgPoolClient } = await import("./store/postgres");
    const client = pgPoolClient(new pg.default.Pool({ connectionString: env.DATABASE_URL }));
    await migrate(client);
    return new PostgresRunStore(client);
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = env.AGENT_DATA_DIR ?? new URL("../data/pglite", import.meta.url).pathname;
  await mkdir(dir, { recursive: true });
  const db = new PGlite(dir);
  await migrate(db);
  return new PostgresRunStore(db as unknown as SqlClient);
}

const store = await openStore();
const market: MarketPort = env.OBSERVER_API_URL ? new ObserverMarket(env.OBSERVER_API_URL, env.OBSERVER_READ_TOKEN) : new DemoMarket();
const rpc = rpcFastFromEnv(env);
const demo = env.DEMO_EXECUTOR === "1";
// Without RPC Fast, the demo uses a mock chain so public balances are "read"; outside the demo they are client-reported (flagged unverified).
const chain: ChainPort | undefined = rpc
  ? { provider: rpc, usdcMint: USDC_MINTS["mainnet-beta"] }
  : demo
    ? { provider: new MockSolanaRpcProvider(), usdcMint: USDC_MINTS["mainnet-beta"] }
    : undefined;

const bus = new RunEventBus();
let orchestrator: Orchestrator;
orchestrator = new Orchestrator({
  store,
  market,
  funding: new OfframpFunding(),
  settlement: new SimulatedSettlement(),
  ...(chain ? { chain } : {}),
  publish: bus.publish,
  schedule: (runId, ms) => setTimeout(() => void orchestrator.advance(runId).catch(() => {}), ms),
  log
});

let demoInfo: { executorId: string } | undefined;
if (demo) {
  if (env.OBSERVER_API_URL) throw new Error("DEMO_EXECUTOR answers from the synthetic demo market; unset OBSERVER_API_URL");
  const { executorId } = await orchestrator.registerExecutor();
  new SimulatedExecutor(orchestrator, market, executorId).start();
  demoInfo = { executorId };
}

const port = Number(env.PORT ?? 8788);
createServer(
  createApp(orchestrator, bus, {
    ...(chain ? { chain } : {}),
    allowedOrigins: (env.WEB_ORIGIN ?? "").split(",").filter(Boolean),
    ...(demoInfo ? { demo: demoInfo } : {}),
    log
  })
).listen(port, () => {
  log({
    event: "listening",
    port,
    store: env.AGENT_STORE ?? "pglite",
    market: env.OBSERVER_API_URL ? "live (observer API)" : "synthetic demo",
    chain: rpc ? "rpc-fast" : chain ? "mock (demo)" : "none (client-reported public balances)",
    settlement: "simulated (no licensed off-ramp)",
    demoExecutor: demoInfo?.executorId ?? null
  });
});
