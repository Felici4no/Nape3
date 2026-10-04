import { planIntent } from "@/lib/market";
import { describeSource } from "@/lib/source";
import { getMarketSource } from "@/lib/source.server";

export const dynamic = "force-dynamic";

async function answer(request: string | null) {
  const text = request?.trim().slice(0, 200) ?? "";
  if (!text) return Response.json({ ok: false, error: "q is required" }, { status: 400 });
  const source = await getMarketSource();
  const plan = planIntent(source, text, new Date(source.fetchedAt));
  return Response.json({ ok: true, source: describeSource(source), plan }, { headers: { "cache-control": "no-store" } });
}

/** The agent over the same market source as the pages. GET ?q=… or POST {"q": "…"}. */
export async function GET(request: Request) {
  return answer(new URL(request.url).searchParams.get("q"));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { q?: unknown } | null;
  return answer(typeof body?.q === "string" ? body.q : null);
}
