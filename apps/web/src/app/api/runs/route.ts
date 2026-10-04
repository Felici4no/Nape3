import { agentApi, relay, runtimeInfo } from "@/lib/agent-runtime";

export const dynamic = "force-dynamic";

/**
 * Starts an agent run. `executor: "extension"` binds it to the browser
 * executor id the extension gave this page; `executor: "demo"` to agent-api's
 * simulated executor (synthetic market, labelled).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { request?: unknown; executor?: unknown; executorId?: unknown } | null;
  if (typeof body?.request !== "string" || !body.request.trim()) return Response.json({ ok: false, error: "request is required" }, { status: 400 });
  let executorId: string | null = null;
  if (body.executor === "demo") executorId = (await runtimeInfo()).demoExecutorId;
  else if (body.executor === "extension" && typeof body.executorId === "string" && /^ex_[A-Za-z0-9_-]{1,40}$/.test(body.executorId)) executorId = body.executorId;
  if (!executorId) return Response.json({ ok: false, error: "no browser executor available" }, { status: 422 });
  return relay(await agentApi("/agent/runs", { method: "POST", body: JSON.stringify({ request: body.request.slice(0, 200), executorId }) }));
}
