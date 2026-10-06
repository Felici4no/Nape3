import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM build script without type declarations
import { buildIndex, renderDoc, rewriteHref, slugOf } from "../../scripts/docs-lib.mjs";

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
});
