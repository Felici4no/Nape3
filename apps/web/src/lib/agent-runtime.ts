/**
 * Server-side access to apps/agent-api (AGENT_API_URL). The browser talks to
 * these Next routes only; the runtime's URL never reaches the client bundle.
 * Run tokens are capabilities held by the browser that created the run and
 * forwarded as bearer tokens.
 */

export function agentApiUrl(): string | null {
  return process.env.AGENT_API_URL ?? null;
}

export async function agentApi(path: string, init: RequestInit & { token?: string } = {}): Promise<Response> {
  const base = agentApiUrl();
  if (!base) return Response.json({ ok: false, error: "agent runtime is not configured (AGENT_API_URL)" }, { status: 503 });
  const { token, headers, ...rest } = init;
  try {
    return await fetch(new URL(path, base), {
      ...rest,
      cache: "no-store",
      headers: { ...(rest.body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers as Record<string, string> | undefined) }
    });
  } catch {
    return Response.json({ ok: false, error: "agent runtime unreachable" }, { status: 502 });
  }
}

/** Relays the runtime's JSON answer (status included). */
export async function relay(response: Response): Promise<Response> {
  const body = await response.text();
  return new Response(body, { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export interface RuntimeInfo {
  configured: boolean;
  /** Executor id of the simulated demo executor, when agent-api runs one. */
  demoExecutorId: string | null;
}

export async function runtimeInfo(): Promise<RuntimeInfo> {
  if (!agentApiUrl()) return { configured: false, demoExecutorId: null };
  const response = await agentApi("/agent/demo");
  if (!response.ok) return { configured: true, demoExecutorId: null };
  const body = (await response.json().catch(() => ({}))) as { executorId?: string };
  return { configured: true, demoExecutorId: body.executorId ?? null };
}

export const RUN_ID = /^run_[A-Za-z0-9_-]{1,40}$/;
