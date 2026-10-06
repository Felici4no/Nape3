import { authorized, createSession } from "@/lib/dev-bridge";
import { bridge, json } from "@/lib/dev-bridge-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Starts a dev-bridge session (random id, 30 min). Needs the bridge token. */
export async function POST(request: Request) {
  const store = bridge();
  if (!store) return json({ error: "not found" }, 404);
  if (!authorized(request, process.env)) return json({ error: "unauthorized" }, 401);
  return json(await createSession(store, Date.now()), 201);
}
