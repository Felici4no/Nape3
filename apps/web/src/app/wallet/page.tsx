import type { Metadata } from "next";
import { WalletScreenLoader } from "@/components/money/loaders";
import { quoteAll } from "@/lib/market";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Wallet" };

export default function WalletPage() {
  const references = quoteAll(new Date())
    .filter((q) => q.summary.medianCents !== null && q.summary.sufficient)
    .map((q) => ({ slug: q.instrument.slug, name: q.instrument.name, cents: q.summary.medianCents! }));
  return <WalletScreenLoader references={references} />;
}
