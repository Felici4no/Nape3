import type { Metadata } from "next";
import { WalletScreenLoader } from "@/components/money/loaders";
import { quoteAll } from "@/lib/market";
import { getMarketSource } from "@/lib/source.server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Wallet" };

export default async function WalletPage() {
  const source = await getMarketSource();
  const references = quoteAll(source, new Date(source.fetchedAt))
    .filter((q) => q.summary.medianCents !== null && q.summary.sufficient)
    .map((q) => ({ slug: q.instrument.slug, name: q.instrument.name, cents: q.summary.medianCents!, synthetic: source.mode === "demo" }));
  return <WalletScreenLoader references={references} />;
}
