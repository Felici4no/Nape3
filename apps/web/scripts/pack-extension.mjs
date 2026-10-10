// Builds the browser extension and publishes it as a download of the site:
// public/downloads/upay3food-extension.zip + extension.json (version, size, sha256).
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(web, "../..");
const dist = join(root, "apps/extension/dist");
const out = join(web, "public/downloads");

execSync("pnpm --filter @nape3/extension build", { cwd: root, stdio: "inherit" });

const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else files[relative(dist, full).split("\\").join("/")] = [readFileSync(full), { mtime: new Date("2026-01-01T00:00:00Z") }];
  }
};
walk(dist);
const zip = zipSync(files, { level: 9 });
const text = Object.values(files).map(([b]) => b.toString("latin1")).join("");
if (/f3Pp|vercel_blob_rw_/.test(text)) throw new Error("refusing to publish: a secret-looking value is in the extension bundle");

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "upay3food-extension.zip"), zip);
const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
const info = {
  version: manifest.version,
  sizeBytes: zip.length,
  sha256: createHash("sha256").update(zip).digest("hex"),
  builtAt: new Date().toISOString(),
  commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || null
};
writeFileSync(join(out, "extension.json"), JSON.stringify(info, null, 2));
// The /instalar page imports this at build time (public/ is not in the server bundle).
mkdirSync(join(web, "src/generated"), { recursive: true });
writeFileSync(join(web, "src/generated/extension-info.json"), JSON.stringify(info, null, 2));
console.log(`extension ${info.version} → public/downloads (${(info.sizeBytes / 1024).toFixed(0)} KB, sha256 ${info.sha256.slice(0, 12)}…)`);
