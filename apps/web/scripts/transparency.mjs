// SHA-256 of the public methodology and of the calculation code, for the
// Solana transparency anchor (/transparencia). Anyone can recompute them:
//   sha256sum docs/05-architecture/price-calculations.md
//   cat <ENGINE_FILES in this order> | sha256sum
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(web, "../..");

export const METHODOLOGY_FILE = "docs/05-architecture/price-calculations.md";
export const ENGINE_FILES = [
  "packages/domain/src/insights.ts",
  "packages/domain/src/liquids.ts",
  "packages/domain/src/burger.ts",
  "packages/domain/src/volume.ts",
  "packages/domain/src/text-readers.ts",
  "packages/agent/src/menu-advisor.ts"
];

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const methodology = readFileSync(join(root, METHODOLOGY_FILE));
const engine = Buffer.concat(ENGINE_FILES.map((f) => readFileSync(join(root, f))));
let commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null;
if (!commit) {
  try {
    commit = execSync("git rev-parse --short=7 HEAD", { cwd: root }).toString().trim();
  } catch {
    commit = null;
  }
}
const info = {
  methodologyFile: METHODOLOGY_FILE,
  methodologySha256: sha(methodology),
  engineFiles: ENGINE_FILES,
  engineSha256: sha(engine),
  commit,
  builtAt: new Date().toISOString()
};
mkdirSync(join(web, "src/generated"), { recursive: true });
writeFileSync(join(web, "src/generated/transparency.json"), JSON.stringify(info, null, 2));
console.log(`transparency: methodology ${info.methodologySha256.slice(0, 12)}… engine ${info.engineSha256.slice(0, 12)}…`);
