import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAllowedPayOrigin, TRUSTED_WEB_ORIGINS } from "../src/shared/payment";
import { DEFAULT_SETTINGS } from "../src/shared/types";

describe("web ↔ extension transport in production", () => {
  it("the public site may message the extension even when Settings point elsewhere (dev)", () => {
    expect(isAllowedPayOrigin("https://upay3food.com", "http://localhost:3000/pay")).toBe(true);
    expect(isAllowedPayOrigin("https://upay3food.com", DEFAULT_SETTINGS.fundingAppUrl)).toBe(true);
  });

  it("no other origin is trusted: not docs, not www (it redirects), not previews, not look-alikes", () => {
    for (const origin of ["https://docs.upay3food.com", "https://www.upay3food.com", "https://upay3food-abc-felici4nos-projects.vercel.app", "https://upay3food.com.evil.example", "http://upay3food.com"]) {
      expect(isAllowedPayOrigin(origin, DEFAULT_SETTINGS.fundingAppUrl)).toBe(false);
    }
  });

  it("the default Pay page is the public site, not localhost", () => {
    expect(new URL(DEFAULT_SETTINGS.fundingAppUrl).origin).toBe("https://upay3food.com");
  });

  it("manifest externally_connectable lists exactly the trusted origins (+ localhost for development), no broad wildcard", () => {
    const manifest = readFileSync(join(__dirname, "..", "manifest.ts"), "utf8");
    const block = /externally_connectable:\s*\{\s*matches:\s*\[([^\]]*)\]/.exec(manifest)?.[1] ?? "";
    const matches = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
    for (const origin of TRUSTED_WEB_ORIGINS) expect(matches).toContain(`${origin}/*`);
    expect(matches.filter((m) => !/^http:\/\/(localhost|127\.0\.0\.1)\//.test(m)).sort()).toEqual(TRUSTED_WEB_ORIGINS.map((o) => `${o}/*`).sort());
    expect(matches.some((m) => /\*\.|https:\/\/\*\//.test(m))).toBe(false);
  });
});
