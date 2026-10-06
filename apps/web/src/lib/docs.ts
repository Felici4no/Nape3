import index from "@/generated/docs-index.json";

/** Static index of every Markdown note in the repository, built by scripts/build-docs.mjs. */
export interface DocEntry {
  slug: string;
  group: string;
  groupLabel: string;
  title: string;
  summary: string;
  date: string | null;
  /** Path in the repository (for "View on GitHub"). */
  source: string;
  html: string;
  toc: Array<{ id: string; text: string; depth: number }>;
  words: number;
}

export const REPO_TREE = "https://github.com/Felici4no/Nape3-UPAY3FOOD/blob/claude/youthful-hypatia-a3c9mn";

export const docs: DocEntry[] = (index as { docs: DocEntry[] }).docs;
export const docsGeneratedAt: string = (index as { generatedAt: string }).generatedAt;

export function docBySlug(slug: string): DocEntry | undefined {
  return docs.find((d) => d.slug === slug);
}

export function groups(): Array<{ key: string; label: string; docs: DocEntry[] }> {
  const out: Array<{ key: string; label: string; docs: DocEntry[] }> = [];
  for (const doc of docs) {
    const last = out[out.length - 1];
    if (last && last.key === doc.group) last.docs.push(doc);
    else out.push({ key: doc.group, label: doc.groupLabel, docs: [doc] });
  }
  return out;
}

/** Dated notes (incidents, spikes, proofs), newest first: the build log. */
export function latestNotes(limit = 6): DocEntry[] {
  return docs.filter((d) => d.date).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.slug.localeCompare(b.slug)).slice(0, limit);
}

/** Display title without Markdown code ticks. */
export const plainTitle = (title: string) => title.replace(/`/g, "");
