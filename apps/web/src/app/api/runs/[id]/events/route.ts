import { agentApiUrl, RUN_ID } from "@/lib/agent-runtime";

export const dynamic = "force-dynamic";

/** SSE passthrough: the browser's EventSource → agent-api's run event stream. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const base = agentApiUrl();
  if (!base || !RUN_ID.test(id)) return new Response("not available", { status: base ? 400 : 503 });
  const url = new URL(request.url);
  const upstream = new URL(`/agent/runs/${id}/events`, base);
  upstream.searchParams.set("token", url.searchParams.get("token") ?? "");
  const lastEventId = request.headers.get("last-event-id");
  try {
    const response = await fetch(upstream, { cache: "no-store", signal: request.signal, headers: lastEventId ? { "last-event-id": lastEventId } : {} });
    if (!response.ok || !response.body) return new Response(await response.text(), { status: response.status });
    return new Response(response.body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
  } catch {
    return new Response("agent runtime unreachable", { status: 502 });
  }
}
