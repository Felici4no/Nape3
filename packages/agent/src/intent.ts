import {
  cents,
  normalizeText,
  parseReaisAmount,
  parseVolumeMl,
  subtractCents,
  type Cents,
  type ProductCategory,
  type PurchaseIntent
} from "@nape3/domain";

/**
 * Deterministic pt-BR intent parser. It only extracts what the user actually
 * said; anything assumed is recorded in `parsing.notes` and anything needed
 * but absent in `parsing.missing`. An LLM fallback can implement
 * `IntentFallbackParser` later — it is not used here.
 */

export type ParseIntentResult =
  | { ok: true; intent: PurchaseIntent }
  | { ok: false; reason: string };

export interface IntentFallbackParser {
  parse(request: string): Promise<ParseIntentResult>;
}

const CATEGORY_PATTERNS: Array<[RegExp, ProductCategory]> = [[/\bacai(s)?\b/, "acai"]];

const NUMBER_WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5
};

const AMOUNT = String.raw`(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:reais|real|conto|pila)?`;

const MAX_PATTERNS: Array<{ re: RegExp; exclusive: boolean }> = [
  { re: new RegExp(String.raw`\b(?:ate|no maximo|maximo de|max)\s*${AMOUNT}`), exclusive: false },
  { re: new RegExp(String.raw`\b(?:por menos de|menos de|abaixo de)\s*${AMOUNT}`), exclusive: true }
];
const TARGET_RE = new RegExp(
  String.raw`\b(?:idealmente|de preferencia|preferencialmente|em torno de|cerca de|uns)\s*${AMOUNT}`
);
const BARE_AMOUNT_RE = new RegExp(String.raw`(?:r\$\s*(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*(?:reais|real)\b)`);

const SPEED_RE = /\b(rapido|urgente|com pressa|logo|o quanto antes)\b/;
const CHEAP_RE = /\b(mais barato|barato|economizar|menor preco)\b/;

export const DEFAULT_PREFERENCES = { priceWeight: 0.8, etaWeight: 0.2 } as const;

export function parseIntent(request: string): ParseIntentResult {
  const text = normalizeText(request);
  if (!text) return { ok: false, reason: "empty request" };

  const category = CATEGORY_PATTERNS.find(([re]) => re.test(text))?.[1];
  if (!category) {
    return { ok: false, reason: "category not supported yet (only açaí is supported in this MVP)" };
  }

  const notes: string[] = [];
  const missing: string[] = [];

  // Volume ---------------------------------------------------------------
  const volumeMl = parseVolumeMl(request);
  if (volumeMl === null) missing.push("product.volumeMl");

  // Quantity -------------------------------------------------------------
  let quantity = 1;
  const qty = /\b(\d{1,2}|um|uma|dois|duas|tres|quatro|cinco)\s+(?:copos?\s+de\s+)?acais?\b/.exec(text);
  if (qty) {
    const raw = qty[1]!;
    quantity = NUMBER_WORDS[raw] ?? Number.parseInt(raw, 10);
  } else {
    missing.push("product.quantity");
    notes.push("quantity not stated; assuming 1 unless a current cart says otherwise");
  }

  // Budget -----------------------------------------------------------------
  let maxCents: Cents | undefined;
  for (const { re, exclusive } of MAX_PATTERNS) {
    const match = re.exec(text);
    if (match) {
      const amount = parseReaisAmount(match[1]!);
      if (amount !== null) {
        maxCents = exclusive ? subtractCents(amount, cents(1)) : amount;
        if (exclusive) notes.push("'menos de' interpreted as strictly below the amount");
      }
      break;
    }
  }
  let targetCents: Cents | undefined;
  const target = TARGET_RE.exec(text);
  if (target) targetCents = parseReaisAmount(target[1]!) ?? undefined;

  if (maxCents === undefined && targetCents === undefined) {
    const bare = BARE_AMOUNT_RE.exec(text);
    if (bare) {
      const amount = parseReaisAmount(bare[1] ?? bare[2]!);
      if (amount !== null) {
        maxCents = amount;
        notes.push("amount without 'até'/'no máximo' interpreted as the maximum budget");
      }
    }
  }
  if (maxCents === undefined) missing.push("budget.maxCents");

  // Preferences --------------------------------------------------------------
  let preferences: { priceWeight: number; etaWeight: number } = { ...DEFAULT_PREFERENCES };
  if (SPEED_RE.test(text)) {
    preferences = { priceWeight: 0.4, etaWeight: 0.6 };
    notes.push("speed requested: ETA weighted 0.6");
  } else if (CHEAP_RE.test(text)) {
    preferences = { priceWeight: 0.95, etaWeight: 0.05 };
    notes.push("lowest price requested: price weighted 0.95");
  } else {
    notes.push("default weights: price 0.8, ETA 0.2");
  }

  const intent: PurchaseIntent = {
    request,
    product: { category, quantity, ...(volumeMl !== null ? { volumeMl } : {}) },
    budget: {
      currency: "BRL",
      ...(maxCents !== undefined ? { maxCents } : {}),
      ...(targetCents !== undefined ? { targetCents } : {})
    },
    preferences,
    execution: { requireConfirmation: true },
    parsing: { method: "deterministic", unparsed: [], missing, notes }
  };
  return { ok: true, intent };
}
