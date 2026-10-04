import { agentApi, relay, RUN_ID } from "@/lib/agent-runtime";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["wallet-state", "confirm", "payment"]);

/** Wallet state, confirmation/rejection and payment submission, forwarded with the run token. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params;
  if (!RUN_ID.test(id) || !ACTIONS.has(action)) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  const token = request.headers.get("x-run-token") ?? undefined;
  const body = await request.text();
  if (body.length > 16_384) return Response.json({ ok: false, error: "body too large" }, { status: 413 });
  return relay(await agentApi(`/agent/runs/${id}/${action}`, { method: "POST", body, ...(token ? { token } : {}) }));
}
