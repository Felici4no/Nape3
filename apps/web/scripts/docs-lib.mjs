import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Marked } from "marked";

/**
 * Turns the repository's Markdown notes (docs/** and apps/*\/README.md) into
 * a static index the docs site renders. Runs at build time only: the site
 * never reads the file system at request time.
 */

export const GROUPS = [
  ["", "General"],
  ["00-overview", "Overview"],
  ["01-problem", "Problem"],
  ["02-user", "User"],
  ["03-market", "Market"],
  ["04-product", "Product"],
  ["05-architecture", "Architecture"],
  ["06-business", "Business"],
  ["07-hackathon", "Hackathon"],
  ["08-proofs", "Proofs"],
  ["decisions", "Decisions (ADRs)"],
  ["incidents", "Incidents"],
  ["spikes", "Spikes"],
  ["apps", "Apps"]
];

const GROUP_ORDER = new Map(GROUPS.map(([key], i) => [key, i]));
export const groupLabel = (key) => GROUPS.find(([k]) => k === key)?.[1] ?? key;

export function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** docs/05-architecture/agent.md → "05-architecture/agent"; docs/README.md → "readme"; folder index.md → the folder. */
export function slugOf(docsRelative) {
  const noExt = docsRelative.split(sep).join("/").replace(/\.md$/i, "");
  if (/^readme$/i.test(noExt)) return "readme";
  return noExt.replace(/\/index$/i, "").replace(/\/readme$/i, "");
}

/** Rewrites a relative Markdown link from `fromSlugDir` to a docs route; leaves external links and anchors alone. */
export function rewriteHref(href, fromDocPath, knownSlugs) {
  if (!href || /^(https?:|mailto:|#)/i.test(href)) return href;
  const [pathPart, hash] = href.split("#");
  if (!/\.md$/i.test(pathPart)) return href;
  const base = fromDocPath.split("/").slice(0, -1);
  for (const part of pathPart.split("/")) {
    if (part === "..") base.pop();
    else if (part !== "." && part !== "") base.push(part);
  }
  const slug = slugOf(base.join("/"));
  if (!knownSlugs.has(slug)) return href;
  return `/docs/${slug}${hash ? `#${hash}` : ""}`;
}

function firstHeading(markdown) {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim() ?? null;
}

function firstParagraph(markdown) {
  const body = markdown.replace(/^#.*$/gm, "").split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^(\||```|>|-|\*|\d+\.)/.test(p));
  return body ? body.replace(/\s+/g, " ").replace(/[*_`]/g, "").slice(0, 220) : "";
}

function dateOf(slug) {
  return /(\d{4}-\d{2}-\d{2})/.exec(slug)?.[1] ?? null;
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.md$/i.test(name)) out.push(full);
  }
  return out;
}

export function renderDoc(markdown, docPath, knownSlugs) {
  const toc = [];
  const used = new Map();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const plain = text.replace(/<[^>]+>/g, "");
        let id = slugify(plain) || "section";
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        if (depth === 2 || depth === 3) toc.push({ id, text: plain, depth });
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${text}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const target = rewriteHref(href, docPath, knownSlugs);
        const external = /^https?:/i.test(target);
        return `<a href="${target}"${title ? ` title="${title}"` : ""}${external ? ' target="_blank" rel="noreferrer"' : ""}>${text}</a>`;
      }
    }
  });
  return { html: marked.parse(markdown), toc };
}

/** Builds the full index from the repository root. */
export function buildIndex(repoRoot) {
  const sources = [];
  const docsDir = join(repoRoot, "docs");
  for (const file of walk(docsDir)) sources.push({ file, docPath: relative(docsDir, file).split(sep).join("/"), source: `docs/${relative(docsDir, file).split(sep).join("/")}` });
  const appsDir = join(repoRoot, "apps");
  for (const app of readdirSync(appsDir)) {
    const readme = join(appsDir, app, "README.md");
    try {
      statSync(readme);
      sources.push({ file: readme, docPath: `apps/${app}.md`, source: `apps/${app}/README.md` });
    } catch {
      /* no README */
    }
  }
  const slugs = new Set(sources.map((s) => slugOf(s.docPath)));
  const docs = sources.map(({ file, docPath, source }) => {
    const markdown = readFileSync(file, "utf8");
    const slug = slugOf(docPath);
    const group = docPath.includes("/") ? docPath.split("/")[0] : "";
    const { html, toc } = renderDoc(markdown, docPath, slugs);
    const title = firstHeading(markdown) ?? slug.split("/").pop();
    return { slug, group, groupLabel: groupLabel(group), title, summary: firstParagraph(markdown), date: dateOf(slug), source, html, toc, words: markdown.split(/\s+/).length };
  });
  docs.sort(
    (a, b) =>
      (GROUP_ORDER.get(a.group) ?? 99) - (GROUP_ORDER.get(b.group) ?? 99) ||
      // folder index first, then dated notes newest first, then by name
      Number(b.slug === b.group) - Number(a.slug === a.group) ||
      (b.date ?? "").localeCompare(a.date ?? "") ||
      a.slug.localeCompare(b.slug)
  );
  return docs;
}
