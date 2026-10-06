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
