import { addCents, cents, subtractCents, type Cents } from "./money";
import { matchesRequirement, type ProductRequirement } from "./normalize";
import type { CartQuote } from "./types";

export interface CartTotals {
  itemsSubtotalCents: Cents;
  deliveryFeeCents: Cents;
  serviceFeeCents: Cents;
  discountCents: Cents;
}

/** total = subtotal + delivery + service − discount (never below zero). */
export function computeCartTotal(parts: CartTotals): Cents {
  if (parts.discountCents < 0) throw new RangeError("discountCents must be positive (amount subtracted)");
  const gross = addCents(parts.itemsSubtotalCents, parts.deliveryFeeCents, parts.serviceFeeCents);
  const total = subtractCents(gross, parts.discountCents);
  return total < 0 ? cents(0) : total;
}

export interface CartConsistency {
  consistent: boolean;
  expectedTotalCents: Cents;
  differenceCents: Cents;
  issues: string[];
}

/**
 * Compares the total the platform displayed with the total implied by its
 * components. A mismatch usually means an unparsed fee or discount; the quote
 * is kept but flagged instead of silently "fixed".
 */
export function verifyCartQuote(quote: CartQuote): CartConsistency {
  const issues: string[] = [];
  const expectedTotalCents = computeCartTotal(quote);
  const differenceCents = subtractCents(quote.totalCents, expectedTotalCents);
  if (differenceCents !== 0) {
    issues.push(
      `displayed total differs from subtotal + fees − discount by ${differenceCents} cents`
    );
  }
  const linesSum = addCents(...quote.lines.map((line) => line.lineTotalCents));
  if (quote.lines.length > 0 && linesSum !== quote.itemsSubtotalCents) {
    issues.push(`line totals (${linesSum}) differ from items subtotal (${quote.itemsSubtotalCents})`);
  }
  return { consistent: issues.length === 0, expectedTotalCents, differenceCents, issues };
}

export interface QuoteComparability {
  comparable: boolean;
  reasons: string[];
}

/**
 * A cart quote is comparable for an intent only if *every* line is the
 * requested product and the total quantity matches. A cart with an extra soda
 * is not a comparable açaí price.
 */
export function quoteMatchesRequirement(
  quote: CartQuote,
  requirement: ProductRequirement,
  quantity: number
): QuoteComparability {
  if (quote.lines.length === 0) return { comparable: false, reasons: ["cart has no lines"] };
  let total = 0;
  for (const line of quote.lines) {
    const match = matchesRequirement(line.product, requirement);
    if (!match.equivalent) {
      return { comparable: false, reasons: [`line "${line.sourceTitle}": ${match.reasons.join("; ")}`] };
    }
    total += line.quantity;
  }
  if (total !== quantity) {
    return { comparable: false, reasons: [`cart has ${total} unit(s), intent asks for ${quantity}`] };
  }
  return { comparable: true, reasons: [`all ${quote.lines.length} line(s) match; quantity ${quantity}`] };
}
