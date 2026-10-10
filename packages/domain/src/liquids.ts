import { isBulkFormat } from "./insights";
import { normalizeText, parseVolumeMl } from "./volume";

/**
 * Price per litre for every liquid on a menu, compared only within its kind
 * (a beer is never ranked against an açaí). Packs count their total volume:
 * "Lata 269ml com 15un" = 15 × 269 ml.
 */

export type LiquidKind = "acai" | "refrigerante" | "suco" | "agua" | "cerveja" | "cha" | "milkshake" | "energetico" | "cafe";

export const LIQUID_LABEL: Record<LiquidKind, string> = {
  acai: "Açaí",
  refrigerante: "Refrigerante",
  suco: "Suco",
  agua: "Água",
  cerveja: "Cerveja",
  cha: "Chá",
  milkshake: "Milk-shake",
  energetico: "Energético",
  cafe: "Café"
};

const KINDS: Array<[LiquidKind, RegExp]> = [
  ["acai", /\bacai\b/],
  ["milkshake", /\b(milk ?shake|shake)\b/],
  ["cerveja", /\b(cerveja|chopp?|pilsen|ipa|lager|heineken|skol|brahma|budweiser|corona|stella|amstel|original)\b/],
  ["energetico", /\b(energetico|red ?bull|monster|tnt)\b/],
  ["refrigerante", /\b(refri|refrigerante|coca|pepsi|guarana|fanta|sprite|soda|tonica|kuat|antarctica)\b/],
  ["suco", /\b(suco|del valle|limonada|laranjada|natural one)\b/],
  ["cha", /\b(cha|mate|ice tea|leao)\b/],
  ["agua", /\b(agua)\b/],
  ["cafe", /\b(cafe|cappuccino|latte|espresso)\b/]
];

export function liquidKind(title: string): LiquidKind | null {
  const t = normalizeText(title);
  return KINDS.find(([, re]) => re.test(t))?.[0] ?? null;
}

/** Units in a drinks pack ("15un", "com 6 latas", "fardo 12", "6x350ml"); 1 when not stated. */
export function drinkUnits(title: string): number {
  const t = normalizeText(title);
  const patterns = [
    /\b(\d{1,2})\s*x\s*\d{2,4}\s*ml\b/,
    /\b(\d{1,2})\s*(?:un|und|unid|unidades|latas|garrafas|long ?necks?)\b/,
    /\b(?:pack|fardo|kit|caixa)\s*(?:com\s*)?(\d{1,2})\b(?!\s*(?:ml|l|litros?)\b)/
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 48) return n;
    }
  }
  return 1;
}

export interface LiquidItem {
  title: string;
  priceCents: number;
  kind: LiquidKind;
  units: number;
  /** Volume of the whole item (units × unit volume), in ml. */
  totalMl: number;
  pricePerLiterCents: number;
  bulk: boolean;
}

export interface LiquidGroup {
  kind: LiquidKind;
  label: string;
  /** Cheapest per litre first (bulk açaí potes excluded; see `bulkBest`). */
  ranked: LiquidItem[];
  spreadPct: number | null;
  bulkBest: LiquidItem | null;
}

export function liquidValue(items: ReadonlyArray<{ title: string; priceCents: number }>): LiquidGroup[] {
  const groups = new Map<LiquidKind, { ranked: LiquidItem[]; bulk: LiquidItem[] }>();
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.title.trim().toLowerCase()}|${item.priceCents}`;
    if (seen.has(key) || item.priceCents <= 0) continue;
    seen.add(key);
    const kind = liquidKind(item.title);
    const ml = parseVolumeMl(item.title);
    if (!kind || !ml) continue;
    // Açaí titles use "2x" for toppings ("2x Amendoim"), so packs only count for drinks.
    const units = kind === "acai" ? 1 : drinkUnits(item.title);
    const totalMl = ml * units;
    const entry: LiquidItem = {
      title: item.title,
      priceCents: item.priceCents,
      kind,
      units,
      totalMl,
      pricePerLiterCents: Math.round((item.priceCents * 1000) / totalMl),
      bulk: kind === "acai" && isBulkFormat(item.title, ml)
    };
    const group = groups.get(kind) ?? { ranked: [], bulk: [] };
    (entry.bulk ? group.bulk : group.ranked).push(entry);
    groups.set(kind, group);
  }
  const out: LiquidGroup[] = [];
  for (const [kind, g] of groups) {
    g.ranked.sort((a, b) => a.pricePerLiterCents - b.pricePerLiterCents || b.totalMl - a.totalMl);
    g.bulk.sort((a, b) => a.pricePerLiterCents - b.pricePerLiterCents);
    const best = g.ranked[0];
    const worst = g.ranked.length > 1 ? g.ranked[g.ranked.length - 1] : undefined;
    out.push({
      kind,
      label: LIQUID_LABEL[kind],
      ranked: g.ranked,
      spreadPct: best && worst ? Math.round(((worst.pricePerLiterCents - best.pricePerLiterCents) / worst.pricePerLiterCents) * 1000) / 10 : null,
      bulkBest: g.bulk[0] ?? null
    });
  }
  return out.sort((a, b) => b.ranked.length - a.ranked.length);
}
