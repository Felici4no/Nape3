// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { takeSnapshot } from "../src/content/extract";
import {
  abbreviateAddress,
  formatUsdcUnits,
  isAllowedPayOrigin,
  parseWalletReport,
  payability,
  walletSummary
} from "../src/shared/payment";

const snap = (name: string, url: string) =>
  takeSnapshot(new JSDOM(readFileSync(join(__dirname, "fixtures", `${name}.html`), "utf8"), { url }).window.document, url);

const ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

describe("payability", () => {
  it("offers crypto payment at a validated checkout with Pix selected", () => {
    const result = payability(snap("checkout-stale-drawer", "https://www.ifood.com.br/pedido/finalizar"));
    expect(result).toEqual({ payable: true, amountCents: 2779, destination: "pix-selected-via-offramp", merchant: "Açaí do Bairro", pixPayload: null });
  });

  it("uses the visible Pix Copia e Cola when present", () => {
    const result = payability(snap("pix", "https://www.ifood.com.br/pedido/pagamento"));
    expect(result).toMatchObject({ payable: true, amountCents: 2779, destination: "pix-payload-via-offramp" });
    expect(result.payable && result.pixPayload).toMatch(/^000201/);
  });

  it("does not offer payment on a cart or an unvalidated checkout", () => {
    expect(payability(snap("cart", "https://www.ifood.com.br/delivery/sp/a/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab")).payable).toBe(false);
    const doc = new JSDOM(readFileSync(join(__dirname, "fixtures", "checkout.html"), "utf8"), { url: "https://www.ifood.com.br/pedido/finalizar" }).window.document;
    [...doc.querySelectorAll("span")].find((s) => s.textContent === "R$ 27,79")!.textContent = "R$ 28,79";
    const result = payability(takeSnapshot(doc, "https://www.ifood.com.br/pedido/finalizar"));
    expect(result).toEqual({ payable: false, reason: "checkout total not validated" });
  });
});

describe("wallet status", () => {
  it("abbreviates addresses and formats USDC base units", () => {
    expect(abbreviateAddress(ADDRESS)).toBe("7xKX…gAsU");
    expect(formatUsdcUnits("12500000")).toBe("12,50 USDC");
    expect(formatUsdcUnits("5665144")).toBe("5,665144 USDC");
    expect(formatUsdcUnits("0")).toBe("0,00 USDC");
  });

  it("summarizes disconnected and stale wallets", () => {
    const now = new Date("2026-10-04T12:00:00Z");
    expect(walletSummary(null, now)).toMatchObject({ connected: false, label: "Wallet not connected" });
    const status = parseWalletReport({ address: ADDRESS, publicUsdc: "25000000", shieldedUsdc: null, solLamports: "1", checkedAt: "2026-10-04T11:00:00Z" })!;
    expect(walletSummary(status, now)).toMatchObject({ connected: true, label: "7xKX…gAsU", publicUsdc: "25,00 USDC", shieldedUsdc: null, stale: true, ageMinutes: 60 });
  });

  it("rejects malformed or hostile reports from the page", () => {
    expect(parseWalletReport({ address: "not-an-address", publicUsdc: "1", shieldedUsdc: null, solLamports: "1", checkedAt: "2026-10-04T11:00:00Z" })).toBeNull();
    expect(parseWalletReport({ address: ADDRESS, publicUsdc: "1.5", shieldedUsdc: null, solLamports: "1", checkedAt: "2026-10-04T11:00:00Z" })).toBeNull();
    const extra = parseWalletReport({ address: ADDRESS, publicUsdc: "1", shieldedUsdc: "2", solLamports: "1", checkedAt: "2026-10-04T11:00:00Z", seed: "x", agentState: "HACKED" });
    expect(extra).not.toHaveProperty("seed");
    expect(extra!.agentState).toBeNull();
  });

  it("only accepts the configured Pay page origin", () => {
    expect(isAllowedPayOrigin("http://localhost:3000", "http://localhost:3000/")).toBe(true);
    expect(isAllowedPayOrigin("https://evil.example", "http://localhost:3000/")).toBe(false);
    expect(isAllowedPayOrigin(undefined, "http://localhost:3000/")).toBe(false);
  });
});
