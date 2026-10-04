import { quoteAll } from "@/lib/market";
import { describeSource } from "@/lib/source";
import { getMarketSource } from "@/lib/source.server";

export const dynamic = "force-dynamic";

/** All instruments over the current market source (live or demo, never mixed). */
export async function GET() {
  const source = await getMarketSource();
  const quotes = quoteAll(source, new Date(source.fetchedAt));
  return Response.json({ source: describeSource(source), quotes }, { headers: { "cache-control": "no-store" } });
}
