import { describe, expect, it } from "vitest";
import {
  addCents,
  cents,
  formatBRL,
  medianCents,
  MoneyError,
  multiplyCents,
  parseAllBRL,
  parseBRL,
  parseReaisAmount,
  subtractCents
} from "./money";

describe("cents", () => {
  it("accepts safe integers only", () => {
    expect(cents(1990)).toBe(1990);
    expect(() => cents(19.9)).toThrow(MoneyError);
    expect(() => cents(Number.NaN)).toThrow(MoneyError);
  });

  it("does integer arithmetic without float drift", () => {
    // 0.1 + 0.2 in reais would drift; in cents it is exact.
    expect(addCents(cents(10), cents(20))).toBe(30);
    expect(addCents(cents(1990), cents(599), cents(99))).toBe(2688);
    expect(subtractCents(cents(2688), cents(500))).toBe(2188);
    expect(multiplyCents(cents(1990), 3)).toBe(5970);
    expect(() => multiplyCents(cents(1990), 1.5)).toThrow(MoneyError);
  });

  it("computes a deterministic median", () => {
    expect(medianCents([])).toBeNull();
    expect(medianCents([cents(2120)])).toBe(2120);
    expect(medianCents([cents(2540), cents(1990), cents(2120)])).toBe(2120);
    expect(medianCents([cents(1990), cents(2000)])).toBe(1995);
    expect(medianCents([cents(1990), cents(1991)])).toBe(1991);
  });
});

describe("parseBRL", () => {
  it.each([
    ["R$ 24,90", 2490],
    ["R$24,90", 2490],
    ["R$ 17,44", 1744],
    ["R$ 1.234,56", 123456],
    ["R$ 25", 2500],
    ["Total R$ 9,9", 990],
    ["- R$ 5,00", -500],
    ["-R$ 5,00", -500],
    ["R$ -5,00", -500]
  ])("%s → %d", (text, expected) => {
    expect(parseBRL(text)).toBe(expected);
  });

  it("returns null without a currency marker", () => {
    expect(parseBRL("Grátis")).toBeNull();
    expect(parseBRL("24,90")).toBeNull();
  });

  it("finds every amount in order", () => {
    expect(parseAllBRL("De R$ 29,90 por R$ 24,90")).toEqual([2990, 2490]);
  });

  it("parses user-typed reais amounts", () => {
    expect(parseReaisAmount("25")).toBe(2500);
    expect(parseReaisAmount("25,9")).toBe(2590);
    expect(parseReaisAmount("19.90")).toBe(1990);
  });
});

describe("formatBRL", () => {
  it("formats pt-BR", () => {
    expect(formatBRL(cents(1744))).toBe("R$17,44");
    expect(formatBRL(cents(123456))).toBe("R$1.234,56");
    expect(formatBRL(cents(-500))).toBe("-R$5,00");
    expect(formatBRL(cents(5))).toBe("R$0,05");
  });
});
