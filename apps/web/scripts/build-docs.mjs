import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIndex } from "./docs-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const out = join(here, "..", "src", "generated", "docs-index.json");
const docs = buildIndex(repoRoot);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), docs }, null, 0));
console.log(`docs: ${docs.length} notes → ${out}`);

// Placeholder so typecheck/dev work before the extension is packed (pack-extension.mjs overwrites it).
{
  const { existsSync, writeFileSync: write } = await import("node:fs");
  const target = new URL("../src/generated/extension-info.json", import.meta.url);
  if (!existsSync(target)) write(target, JSON.stringify({ version: null, sizeBytes: 0, sha256: "", builtAt: null, commit: null }));
}
