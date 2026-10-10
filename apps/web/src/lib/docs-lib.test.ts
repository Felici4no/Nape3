import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM build script without type declarations
import { buildGraph, buildIndex, layoutGraph, renderDoc, rewriteHref, slugOf } from "../../scripts/docs-lib.mjs";

const repoRoot = resolve(__dirname, "../../../..");

function markdownUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return markdownUnder(full);
    return e.name.endsWith(".md") ? [relative(join(repoRoot, "docs"), full)] : [];
  });
}

describe("docs generator", () => {
  it("derives slugs from paths", () => {
    expect(slugOf("README.md")).toBe("readme");
    expect(slugOf("decisions/README.md")).toBe("decisions");
    expect(slugOf("incidents/2026-10-06-x.md")).toBe("incidents/2026-10-06-x");
  });

  it("rewrites relative note links to docs routes and leaves the rest", () => {
    const known = new Set(["decisions/0001-a", "readme"]);
    expect(rewriteHref("../decisions/0001-a.md#why", "incidents/x.md", known)).toBe("/docs/decisions/0001-a#why");
    expect(rewriteHref("./missing.md", "incidents/x.md", known)).toBe("./missing.md");
    expect(rewriteHref("https://example.com/a.md", "readme.md", known)).toBe("https://example.com/a.md");
  });

  it("renders headings with anchors and a toc", () => {
    const doc = renderDoc("# Title\n\n## Part one\n\ntext", "x.md", new Set());
    expect(doc.html).toContain('id="part-one"');
    expect(doc.toc).toEqual([expect.objectContaining({ id: "part-one", depth: 2 })]);
  });

  it("indexes every note under docs/", () => {
    const slugs = new Set(buildIndex(repoRoot).map((d: { slug: string }) => d.slug));
    for (const file of markdownUnder(join(repoRoot, "docs"))) expect(slugs).toContain(slugOf(file));
  });

  it("turns GitHub/Obsidian callouts into callout boxes and keeps plain quotes", () => {
    const tip = renderDoc("> [!TIP]\n> Shield first.", "x.md", new Set()).html;
    expect(tip).toContain('data-callout="tip"');
    expect(tip).toContain('<div class="callout-title">Tip</div>');
    expect(tip).toContain("<p>Shield first.</p>");
    expect(renderDoc("> [!warning] Careful\n> body", "x.md", new Set()).html).toContain('<div class="callout-title">Careful</div>');
    expect(renderDoc("> just a quote", "x.md", new Set()).html).toContain("<blockquote>");
  });

  it("records internal links and decodes entities in the outline", () => {
    const doc = renderDoc('## "Quoted" part\n\nSee [a](../decisions/0001-a.md).', "incidents/x.md", new Set(["decisions/0001-a"]));
    expect(doc.links).toEqual(["decisions/0001-a"]);
    expect(doc.toc[0].text).toBe('"Quoted" part');
  });

  it("builds backlinks and a deterministic, normalized graph", () => {
    const docs = buildIndex(repoRoot);
    const proof = docs.find((d: { slug: string }) => d.slug === "08-proofs/2026-10-05-mainnet-shield");
    expect(proof.backlinks.length).toBeGreaterThan(0);
    const a = buildGraph(docs);
    const b = buildGraph(docs);
    expect(a).toEqual(b);
    for (const n of a.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(1);
    }
    expect(layoutGraph([{ slug: "a", group: "" }], [])).toHaveLength(1);
  });
});
