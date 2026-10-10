// Copies the real, sanitized menu text of one shop (the regression fixture) into
// a module the home page can import, so its "real shop" numbers are computed by
// the same engine as the extension and the MCP server, never typed by hand.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(web, "../..");
const FIXTURE = "packages/domain/src/__fixtures__/maranata-menu-text.txt";

const out = {
  shop: "Maranata Açaí",
  city: "São Paulo",
  observedOn: "2026-10-10",
  shopUrl: "https://www.ifood.com.br/delivery/sao-paulo-sp/maranata-acai-cidade-lider/28dbb602-58b9-4a3c-a1c1-812533f2b12f",
  source: FIXTURE,
  text: readFileSync(join(root, FIXTURE), "utf8")
};
mkdirSync(join(web, "src/generated"), { recursive: true });
writeFileSync(join(web, "src/generated/case-study.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`case-study: ${out.shop} · ${out.text.length} chars`);
