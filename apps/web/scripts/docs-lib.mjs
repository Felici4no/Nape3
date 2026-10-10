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

const ENTITIES = { "&quot;": '"', "&#39;": "'", "&amp;": "&", "&lt;": "<", "&gt;": ">" };
const decodeEntities = (s) => s.replace(/&(quot|#39|amp|lt|gt);/g, (m) => ENTITIES[m]);

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

const CALLOUT = /^<p>\[!(\w+)\][+-]?[ \t]*([^\n<]*)(?:\n|<br>)?/i;
const CALLOUT_TITLES = { note: "Note", info: "Info", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution", danger: "Danger", success: "Success", quote: "Quote", example: "Example" };

export function renderDoc(markdown, docPath, knownSlugs) {
  const toc = [];
  const links = new Set();
  const used = new Map();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const plain = decodeEntities(text.replace(/<[^>]+>/g, ""));
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
        const internal = target.startsWith("/docs/");
        if (internal) links.add(target.slice(6).split("#")[0]);
        const cls = internal ? ' class="internal-link"' : external ? ' class="external-link"' : "";
        return `<a href="${target}"${cls}${title ? ` title="${title}"` : ""}${external ? ' target="_blank" rel="noreferrer"' : ""}>${text}</a>`;
      },
      // Obsidian callouts: "> [!warning] Title" → a styled box; any other quote stays a quote.
      blockquote({ tokens }) {
        const body = this.parser.parse(tokens);
        const m = CALLOUT.exec(body);
        if (!m) return `<blockquote>\n${body}</blockquote>\n`;
        const type = m[1].toLowerCase();
        const title = m[2].trim() || CALLOUT_TITLES[type] || type;
        const rest = body.slice(m[0].length).replace(/^<\/p>\n?/, "");
        const inner = rest.trim() ? (/^<(p|ul|ol|pre|table|div|h\d|blockquote)[\s>]/.test(rest) ? rest : `<p>${rest}`) : "";
        return `<div class="callout" data-callout="${type}"><div class="callout-title">${title}</div><div class="callout-content">${inner}</div></div>\n`;
      }
    }
  });
  return { html: marked.parse(markdown), toc, links: [...links] };
}

/** Kind of note, from where it lives: shown as a tag. */
function kindOf(group) {
  return { incidents: "incident", spikes: "spike", "08-proofs": "proof", decisions: "decision", apps: "app" }[group] ?? "note";
}

/**
 * Deterministic force layout for the graph view (no randomness, so every
 * build draws the same map). Coordinates come out normalized to 0..1.
 */
export function layoutGraph(nodes, edges) {
  const n = nodes.length;
  const groups = [...new Set(nodes.map((d) => d.group))];
  const pos = nodes.map((d, i) => {
    const g = groups.indexOf(d.group);
    const a = (g / groups.length) * Math.PI * 2 + i * 0.37;
    const r = 0.25 + ((i * 7919) % 100) / 400;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0 };
  });
  const index = new Map(nodes.map((d, i) => [d.slug, i]));
  const springs = edges.map(([a, b]) => [index.get(a), index.get(b)]).filter(([a, b]) => a !== undefined && b !== undefined);
  for (let step = 0; step < 400; step++) {
    const cool = 1 - step / 400;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x;
        const dy = pos[i].y - pos[j].y;
        const d2 = Math.max(dx * dx + dy * dy, 0.0004);
        const f = 0.0009 / d2;
        pos[i].vx += dx * f; pos[i].vy += dy * f;
        pos[j].vx -= dx * f; pos[j].vy -= dy * f;
      }
    }
    for (const [a, b] of springs) {
      const dx = pos[b].x - pos[a].x;
      const dy = pos[b].y - pos[a].y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const f = (d - 0.16) * 0.04;
      pos[a].vx += (dx / d) * f; pos[a].vy += (dy / d) * f;
      pos[b].vx -= (dx / d) * f; pos[b].vy -= (dy / d) * f;
    }
    // same folder pulls together a little; everything drifts to the middle
    for (const g of groups) {
      const members = nodes.map((d, i) => (d.group === g ? i : -1)).filter((i) => i >= 0);
      const cx = members.reduce((s, i) => s + pos[i].x, 0) / members.length;
      const cy = members.reduce((s, i) => s + pos[i].y, 0) / members.length;
      for (const i of members) { pos[i].vx += (cx - pos[i].x) * 0.012; pos[i].vy += (cy - pos[i].y) * 0.012; }
    }
    for (const p of pos) {
      p.vx -= p.x * 0.01; p.vy -= p.y * 0.01;
      p.x += p.vx * cool; p.y += p.vy * cool;
      p.vx *= 0.6; p.vy *= 0.6;
    }
  }
  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const round = (v) => Math.round(v * 1000) / 1000;
  return nodes.map((d, i) => ({ slug: d.slug, group: d.group, x: round((pos[i].x - minX) / (maxX - minX || 1)), y: round((pos[i].y - minY) / (maxY - minY || 1)) }));
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
    const { html, toc, links } = renderDoc(markdown, docPath, slugs);
    const title = firstHeading(markdown) ?? slug.split("/").pop();
    const fileName = docPath.split("/").pop().replace(/\.md$/i, "");
    return {
      slug, group, groupLabel: groupLabel(group), title, file: fileName, kind: kindOf(group), summary: firstParagraph(markdown), date: dateOf(slug), source, html, toc,
      words: markdown.split(/\s+/).length, links: links.filter((l) => l !== slug), backlinks: []
    };
  });
  const bySlug = new Map(docs.map((d) => [d.slug, d]));
  for (const d of docs) for (const l of d.links) bySlug.get(l)?.backlinks.includes(d.slug) || bySlug.get(l)?.backlinks.push(d.slug);
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

/**
 * Nodes and edges of the whole vault, laid out for the graph view. "link"
 * edges are real Markdown links; "folder" edges tie each note to its
 * folder's index (and each index to the vault README), like a folder-aware
 * graph, so notes nobody links to yet still sit next to their section.
 */
export function buildGraph(docs) {
  const edges = [];
  const seen = new Set();
  const add = (a, b, kind) => {
    const key = [a, b].sort().join("|");
    if (a === b || seen.has(key)) return;
    seen.add(key);
    edges.push([a, b, kind]);
  };
  for (const d of docs) for (const l of d.links) add(d.slug, l, "link");
  const slugs = new Set(docs.map((d) => d.slug));
  for (const d of docs) {
    const index = d.group && slugs.has(d.group) ? d.group : "readme";
    if (d.slug === d.group) add(d.slug, "readme", "folder");
    else if (slugs.has(index)) add(d.slug, index, "folder");
  }
  return { nodes: layoutGraph(docs, edges), edges };
}
