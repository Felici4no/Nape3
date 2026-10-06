import { proxyHealth } from "@/lib/solana-rpc-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Read-only health of the Solana RPC path: proxy configured? upstream (RPC
 * Fast) answering getHealth / getGenesisHash / getSlot? on mainnet-beta?
 * Takes no input and returns fixed fields only (never the endpoint or key).
 */
export async function GET() {
  const health = await proxyHealth(process.env);
  return Response.json(health, { status: 200, headers: { "cache-control": "no-store" } });
}
