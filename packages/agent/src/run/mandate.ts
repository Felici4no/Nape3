import { formatBRL, type Cents } from "@nape3/domain";

/**
 * Future autonomous purchases. Today every payment needs USER_CONFIRMATION;
 * a mandate would replace it as the authorization basis
 * (VALID_SPENDING_MANDATE → PAYMENT_AUTHORIZED). The evaluation exists and is
 * tested, but the run reducer refuses the mandate basis until it is enabled.
 */
export interface SpendingMandate {
  id: string;
  maxPerTransactionCents: number;
  maxDailyCents: number;
  allowedCategories?: string[];
  allowedAddressId?: string;
  validUntil?: string;
  maxEtaMinutes?: number;
}

export interface MandateCheck {
  amountCents: Cents;
  category: string;
  /** Sum already spent under this mandate in the current day. */
  spentTodayCents: number;
  addressId?: string;
  etaMaxMinutes?: number;
}

export function evaluateMandate(mandate: SpendingMandate, check: MandateCheck, now: Date): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (mandate.validUntil && Date.parse(mandate.validUntil) <= now.getTime()) reasons.push("mandate has expired");
  if (check.amountCents > mandate.maxPerTransactionCents) {
    reasons.push(`${formatBRL(check.amountCents)} exceeds the per-transaction limit of ${formatBRL(mandate.maxPerTransactionCents as Cents)}`);
  }
  if (check.spentTodayCents + check.amountCents > mandate.maxDailyCents) {
    reasons.push(`would exceed the daily limit of ${formatBRL(mandate.maxDailyCents as Cents)}`);
  }
  if (mandate.allowedCategories && !mandate.allowedCategories.includes(check.category)) reasons.push(`category ${check.category} is not allowed`);
  if (mandate.allowedAddressId && check.addressId !== mandate.allowedAddressId) reasons.push("delivery address is not the allowed one");
  if (mandate.maxEtaMinutes !== undefined && (check.etaMaxMinutes === undefined || check.etaMaxMinutes > mandate.maxEtaMinutes)) {
    reasons.push(`ETA is unknown or above ${mandate.maxEtaMinutes} min`);
  }
  return { ok: reasons.length === 0, reasons };
}
