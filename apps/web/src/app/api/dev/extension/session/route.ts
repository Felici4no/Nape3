import { authorized, createSession } from "@/lib/dev-bridge";
import { bridge, json, preflight, storeError } from "@/lib/dev-bridge-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Starts a dev-bridge session (random id, 30 min). Needs the bridge token. */
export async function POST(request: Request) {
  const store = bridge();
  if (!store) return json({ error: "not found" }, 404, request);
  if (!authorized(request, process.env)) return json({ error: "unauthorized" }, 401, request);
  try {
    return json(await createSession(store, Date.now()), 201, request);
  } catch (error) {
    return storeError(error, request);
  }
}

export function OPTIONS(request: Request) {
  return preflight(request);
}
