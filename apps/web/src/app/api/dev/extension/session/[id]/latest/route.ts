import { latestSnapshot } from "@/lib/dev-bridge";
import { bridge, json } from "@/lib/dev-bridge-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Latest sanitized snapshot of a session (or ?index=N, 0 = oldest). The random session id is the capability. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const store = bridge();
  if (!store) return json({ error: "not found" }, 404);
  const { id } = await params;
  const raw = new URL(request.url).searchParams.get("index");
  const index = raw !== null && /^\d{1,4}$/.test(raw) ? Number(raw) : undefined;
  const latest = await latestSnapshot(store, id, Date.now(), index);
  return latest.found ? json({ count: latest.count, snapshot: latest.snapshot }) : json({ error: "no snapshot (unknown or expired session)" }, 404);
}
