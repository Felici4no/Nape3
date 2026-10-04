import { describe, expect, it } from "vitest";
import { cents } from "@nape3/domain";
import { buildStaticPixBrCode, crc16ccitt, looksLikePixPayload, parsePixBrCode } from "./pix";
import { brlCentsToUsdcBaseUnits, formatUsdc, formatUsdcDisplay, MockWallet } from "./solana";
import { MockOfframp } from "./offramp";
import { PaymentRouter } from "./router";

// Example payload from the Banco Central "Manual de Padrões para Iniciação do Pix".
const BCB_EXAMPLE =
  "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D";

describe("Pix BR Code", () => {
  it("computes CRC16-CCITT (check value)", () => {
    expect(crc16ccitt("123456789")).toBe("29B1");
  });

  it("parses the Banco Central example", () => {
    const result = parsePixBrCode(BCB_EXAMPLE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toMatchObject({
      crcValid: true,
      pixKey: "123e4567-e12b-12d1-a456-426655440000",
      merchantName: "Fulano de Tal",
      merchantCity: "BRASILIA",
      currency: "986",
      txid: "***"
    });
    expect(result.code.amountCents).toBeUndefined();
  });

  it("round-trips a built code with an amount and detects tampering", () => {
    const payload = buildStaticPixBrCode({
      pixKey: "loja@example.com",
      merchantName: "ACAI TESTE",
      merchantCity: "SAO PAULO",
      amountCents: cents(1744),
      txid: "PEDIDO123"
    });
    expect(looksLikePixPayload(payload)).toBe(true);
    const parsed = parsePixBrCode(payload);
    expect(parsed.ok && parsed.code.amountCents).toBe(1744);
    expect(parsed.ok && parsed.code.crcValid).toBe(true);

    const tampered = parsePixBrCode(payload.replace("17.44", "11.44"));
    expect(tampered.ok && tampered.code.crcValid).toBe(false);
  });

  it("rejects non-Pix payloads", () => {
    expect(parsePixBrCode("hello").ok).toBe(false);
    expect(parsePixBrCode("000201010211").ok).toBe(false);
  });
});

describe("Solana preparation", () => {
  it("converts BRL cents to USDC base units with bigint, rounding up", () => {
    expect(brlCentsToUsdcBaseUnits(540, 540)).toBe(1_000_000n);
    expect(brlCentsToUsdcBaseUnits(1744, 540)).toBe(3_229_630n);
    expect(formatUsdc(3_229_630n)).toBe("3.229630 USDC");
    expect(formatUsdcDisplay(25_000_000n)).toBe("25,00 USDC");
    expect(formatUsdcDisplay(5_665_144n)).toBe("5,665144 USDC");
    expect(formatUsdcDisplay(1_234_500_000n)).toBe("1.234,50 USDC");
  });
});

describe("PaymentRouter (simulation only)", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const payload = buildStaticPixBrCode({
    pixKey: "loja@example.com",
    merchantName: "ACAI TESTE",
    merchantCity: "SAO PAULO",
    amountCents: cents(1744)
  });

  it("plans the wallet → USDC → off-ramp → Pix route", async () => {
    const router = new PaymentRouter(new MockWallet(10_000_000n), new MockOfframp());
    const plan = await router.plan(payload, now);
    expect(plan.blockers).toEqual([]);
    expect(plan.simulated).toBe(true);
    expect(plan.steps.at(-1)).toBe("SIMULATION: no real funds move");
  });

  it("requires a matching explicit authorization", async () => {
    const router = new PaymentRouter(new MockWallet(10_000_000n), new MockOfframp());
    const plan = await router.plan(payload, now);
    await expect(
      router.execute(plan, { confirmedByUser: true, amountCents: cents(1000), at: now.toISOString() }, now)
    ).rejects.toThrow("does not match");
    const result = await router.execute(plan, { confirmedByUser: true, amountCents: cents(1744), at: now.toISOString() }, now);
    expect(result).toMatchObject({ status: "settled", simulated: true });
  });

  it("blocks when balance is insufficient", async () => {
    const router = new PaymentRouter(new MockWallet(1n), new MockOfframp());
    const plan = await router.plan(payload, now);
    expect(plan.blockers.join()).toContain("insufficient USDC");
  });
});
