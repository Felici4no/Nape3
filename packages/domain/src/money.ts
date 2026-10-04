/**
 * Money is always represented as integer minor units (cents) plus an explicit
 * currency. `Cents` is a branded number so a bare `number` (reais, floats,
 * percentages, minutes) cannot be passed where an amount of money is expected.
 */

export type Currency = "BRL";

declare const centsBrand: unique symbol;
export type Cents = number & { readonly [centsBrand]: "Cents" };

export interface Money {
  amountCents: Cents;
  currency: Currency;
}

export class MoneyError extends Error {
  override name = "MoneyError";
}

/** Validates that `value` is a safe integer and brands it as cents. */
export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Cents must be a safe integer, received ${String(value)}`);
  }
  return value as Cents;
}

export const ZERO_CENTS: Cents = cents(0);

export function addCents(...values: Cents[]): Cents {
  return cents(values.reduce<number>((sum, value) => sum + value, 0));
}

export function subtractCents(a: Cents, b: Cents): Cents {
  return cents(a - b);
}

export function multiplyCents(value: Cents, quantity: number): Cents {
  if (!Number.isSafeInteger(quantity)) {
    throw new MoneyError(`Quantity must be an integer, received ${quantity}`);
  }
  return cents(value * quantity);
}

export function compareCents(a: Cents, b: Cents): number {
  return a - b;
}

/** Median rounded half-up to the nearest cent (deterministic for even samples). */
export function medianCents(values: readonly Cents[]): Cents | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort(compareCents);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  const sum = sorted[mid - 1]! + sorted[mid]!;
  return cents(Math.floor((sum + 1) / 2));
}

/**
 * Parses a Brazilian-formatted money string ("R$ 1.234,56", "R$12,90",
 * "- R$ 5,00", "R$ 25") into cents using string arithmetic only (no floats).
 * Returns null when the text does not contain a BRL amount.
 */
const BRL_RE = /(-|−)?\s*R\$\s*(-|−)?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/;

export function parseBRL(text: string): Cents | null {
  const match = BRL_RE.exec(text.replace(/ /g, " "));
  if (!match) return null;
  const negative = Boolean(match[1] || match[2]);
  const integerPart = match[3]!.replace(/\./g, "");
  const fraction = (match[4] ?? "0").padEnd(2, "0");
  const value = Number.parseInt(integerPart, 10) * 100 + Number.parseInt(fraction, 10);
  return cents(negative ? -value : value);
}

/** Finds every BRL amount in a text, in order of appearance. */
export function parseAllBRL(text: string): Cents[] {
  const global = new RegExp(BRL_RE.source, "g");
  const normalized = text.replace(/ /g, " ");
  const result: Cents[] = [];
  for (const match of normalized.matchAll(global)) {
    const parsed = parseBRL(match[0]);
    if (parsed !== null) result.push(parsed);
  }
  return result;
}

/** Parses "25", "25,90", "25.90", "R$ 25" as an amount in reais → cents. */
export function parseReaisAmount(text: string): Cents | null {
  const match = /(\d+)(?:[.,](\d{1,2}))?/.exec(text);
  if (!match) return null;
  const fraction = (match[2] ?? "0").padEnd(2, "0");
  return cents(Number.parseInt(match[1]!, 10) * 100 + Number.parseInt(fraction, 10));
}

export function formatBRL(value: Cents): string {
  const negative = value < 0;
  const abs = Math.abs(value);
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const centavos = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}R$${reais},${centavos}`;
}
