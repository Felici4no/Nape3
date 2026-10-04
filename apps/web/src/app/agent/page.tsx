import type { Metadata } from "next";
import { INSTRUMENTS } from "@/lib/market";
import { AgentConsole } from "./AgentConsole";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return <AgentConsole initial={q?.slice(0, 200) ?? "quero um açaí 500ml até R$25"} instruments={INSTRUMENTS.map((i) => ({ slug: i.slug, intent: i.intent, requirement: i.requirement }))} />;
}
