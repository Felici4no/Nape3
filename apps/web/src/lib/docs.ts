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
  /** File name without .md, as a vault would show it. */
  file: string;
  /** incident · spike · proof · decision · app · note */
  kind: string;
  /** Notes this one links to, and notes that link here. */
  links: string[];
  backlinks: string[];
}

export interface GraphNode { slug: string; group: string; x: number; y: number }
export type GraphEdge = [string, string, "link" | "folder"];

export const REPO_TREE = "https://github.com/Felici4no/Nape3-UPAY3FOOD/blob/claude/youthful-hypatia-a3c9mn";

export const docs: DocEntry[] = (index as unknown as { docs: DocEntry[] }).docs;
export const graph = (index as unknown as { graph: { nodes: GraphNode[]; edges: GraphEdge[] } }).graph;
export const docsGeneratedAt: string = (index as unknown as { generatedAt: string }).generatedAt;

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

/** The vault as folders of files: root notes first, then each folder; index/README first, then by file name. */
export interface VaultFolder { key: string; name: string; label: string; files: Array<{ slug: string; file: string; title: string; kind: string }> }
export function vaultTree(): { root: VaultFolder["files"]; folders: VaultFolder[] } {
  const entry = (d: DocEntry) => ({ slug: d.slug, file: d.slug === d.group ? (d.source.endsWith("README.md") ? "README" : "index") : d.file, title: plainTitle(d.title), kind: d.kind });
  const sort = (a: { file: string }, b: { file: string }) => Number(/^(README|index)$/.test(b.file)) - Number(/^(README|index)$/.test(a.file)) || a.file.localeCompare(b.file);
  const root = docs.filter((d) => d.group === "").map(entry).sort(sort);
  const folders = groups()
    .filter((g) => g.key !== "")
    .map((g) => ({ key: g.key, name: g.key, label: g.label, files: g.docs.map(entry).sort(sort) }));
  return { root, folders };
}

/** Notes one link away (either direction, plus the folder index), for the local graph. */
export function neighbours(slug: string): Set<string> {
  const out = new Set<string>([slug]);
  for (const [a, b] of graph.edges) {
    if (a === slug) out.add(b);
    if (b === slug) out.add(a);
  }
  return out;
}
