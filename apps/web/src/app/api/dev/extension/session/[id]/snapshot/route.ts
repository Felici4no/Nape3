import { addSnapshot, authorized, MAX_SNAPSHOT_BYTES } from "@/lib/dev-bridge";
import { bridge, json } from "@/lib/dev-bridge-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stores one sanitized snapshot (re-checked here; anything with PII is refused). Needs the bridge token. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const store = bridge();
  if (!store) return json({ error: "not found" }, 404);
  if (!authorized(request, process.env)) return json({ error: "unauthorized" }, 401);
  if (Number(request.headers.get("content-length") ?? "0") > MAX_SNAPSHOT_BYTES) return json({ error: "snapshot too large" }, 413);
  const { id } = await params;
  const result = await addSnapshot(store, id, await request.text(), Date.now());
  return result.ok ? json({ stored: result.stored }, 201) : json({ error: result.error }, result.status);
}
