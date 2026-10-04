import type { Metadata } from "next";
import { INSTRUMENTS, planIntent } from "@/lib/market";
import { describeSource } from "@/lib/source";
import { getMarketSource } from "@/lib/source.server";
import { AgentConsole } from "./AgentConsole";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Agent" };

export default async function AgentPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const initial = q?.slice(0, 200) || "quero um açaí 500ml até R$25";
  const source = await getMarketSource();
  const plan = planIntent(source, initial, new Date(source.fetchedAt));
  return (
    <AgentConsole
      initial={initial}
      initialPlan={plan}
      initialSource={describeSource(source)}
      instruments={INSTRUMENTS.map((i) => ({ slug: i.slug, intent: i.intent, requirement: i.requirement }))}
    />
  );
}
