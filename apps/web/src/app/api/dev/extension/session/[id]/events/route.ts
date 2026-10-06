import { listSnapshots } from "@/lib/dev-bridge";
import { bridge, json } from "@/lib/dev-bridge-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Snapshot list of a session (names, sizes, times), newest last. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const store = bridge();
  if (!store) return json({ error: "not found" }, 404);
  const { id } = await params;
  const snaps = await listSnapshots(store, id, Date.now());
  if (!snaps) return json({ error: "unknown or expired session" }, 404);
  return json({ snapshots: snaps.map((s) => ({ name: s.pathname.slice(s.pathname.lastIndexOf("/") + 1), size: s.size, uploadedAt: s.uploadedAt.toISOString() })) });
}
