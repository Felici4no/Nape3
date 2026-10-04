import { findInstrument, quoteInstrument } from "@/lib/market";
import { describeSource } from "@/lib/source";
import { getMarketSource } from "@/lib/source.server";

export const dynamic = "force-dynamic";

/** One instrument: summary, 24 h movement, comparable observations and empty-state facts. */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const instrument = findInstrument(slug);
  if (!instrument) return Response.json({ ok: false, error: "unknown instrument" }, { status: 404 });
  const source = await getMarketSource();
  const quote = quoteInstrument(source.observations, instrument, new Date(source.fetchedAt), source.mode);
  return Response.json({ source: describeSource(source), quote }, { headers: { "cache-control": "no-store" } });
}
