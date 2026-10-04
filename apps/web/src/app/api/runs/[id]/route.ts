import { agentApi, relay, RUN_ID } from "@/lib/agent-runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!RUN_ID.test(id)) return Response.json({ ok: false, error: "invalid run id" }, { status: 400 });
  const token = request.headers.get("x-run-token") ?? undefined;
  return relay(await agentApi(`/agent/runs/${id}`, { ...(token ? { token } : {}) }));
}
