import { handleSolanaRpc } from "@/lib/solana-rpc-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Same-origin Solana RPC for the browser. The RPC Fast endpoint and key come
 * from server-side env (RPC_FAST_URL) and never reach the client; see
 * lib/solana-rpc-proxy.ts for the rules.
 */
export async function POST(request: Request) {
  return handleSolanaRpc(request, process.env);
}
