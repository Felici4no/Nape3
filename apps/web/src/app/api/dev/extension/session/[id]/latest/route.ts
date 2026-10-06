import { latestSnapshot } from "@/lib/dev-bridge";
import { bridge, json } from "@/lib/dev-bridge-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Latest sanitized snapshot of a session. The random session id is the capability. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const store = bridge();
  if (!store) return json({ error: "not found" }, 404);
  const { id } = await params;
  const latest = await latestSnapshot(store, id, Date.now());
  return latest.found ? json({ count: latest.count, snapshot: latest.snapshot }) : json({ error: "no snapshot (unknown or expired session)" }, 404);
}
