import { normalizeText } from "./volume";

/**
 * Deterministic reading of burger titles (pt-BR menus): meat grams, meat
 * type, patties and whether it is a combo. Nothing is inferred that the
 * title does not say.
 */

export type MeatType = "bovino" | "frango" | "suino" | "vegetal" | "peixe" | "misto";

const MEAT: Array<[MeatType, RegExp]> = [
  ["vegetal", /\b(vegano|vegan|vegetariano|plant|futuro|nao ?carne|grao de bico|falafel)\b/],
  ["frango", /\b(frango|chicken|crispy)\b/],
  ["suino", /\b(porco|suino|pork|costelinha suina|bacon burger)\b/],
  ["peixe", /\b(peixe|salmao|tilapia|fish)\b/],
  ["bovino", /\b(blend|bovino|carne|angus|costela|picanha|fraldinha|cupim|smash|wagyu|maminha|acem|patinho|bife)\b/]
];

export interface BurgerReading {
  /** Total meat in grams (patties × grams), when the title states grams. */
  meatGrams: number | null;
  patties: number;
  meatType: MeatType | null;
  /** Cut or style named in the title (e.g. "costela", "smash", "angus"). */
  cut: string | null;
  isCombo: boolean;
  /** What the combo adds, as named (batata, refri, bebida…). */
  comboExtras: string[];
  /** Title without size/combo words, to match a combo with its standalone burger. */
  baseName: string;
}

const CUTS = /\b(costela|picanha|fraldinha|cupim|angus|wagyu|smash|maminha|blend)\b/;
const EXTRAS: Array<[string, RegExp]> = [
  ["batata", /\b(batata|fritas|frita|onion rings?|aneis de cebola)\b/],
  ["refri", /\b(refri|refrigerante|coca|guarana|soda|bebida|suco|lata)\b/],
  ["sobremesa", /\b(sobremesa|milk ?shake|sorvete|brownie)\b/]
];

export function readBurger(title: string): BurgerReading {
  const t = normalizeText(title);
  // "2x 150g", "2 x 90g", "duplo 2x90g", "smash duplo 90g" (per patty), "180g".
  let patties = 1;
  let gramsEach: number | null = null;
  const multi = /(\d)\s*x\s*(\d{2,3})\s*g\b/.exec(t);
  if (multi) {
    patties = Number(multi[1]);
    gramsEach = Number(multi[2]);
  } else {
    const grams = /(\d{2,3})\s*(?:g|gr|gramas)\b/.exec(t);
    if (grams) gramsEach = Number(grams[1]);
    if (/\btriplo\b/.test(t)) patties = 3;
    else if (/\b(duplo|double|2 carnes|dois hamburgueres)\b/.test(t)) patties = 2;
  }
  const meatType = MEAT.find(([, re]) => re.test(t))?.[0] ?? null;
  const extras = EXTRAS.filter(([, re]) => re.test(t)).map(([name]) => name);
  const isCombo = /\b(combo|lanche ?\+|com batata|\+ ?batata|\+ ?refri|\+ ?bebida)\b/.test(t) || extras.length >= 2;
  const baseName = t
    .replace(/\bcombo\b/g, "")
    .replace(/\+.*$/, "")
    .replace(/\b(com|e)\s+(batata|fritas|refri|refrigerante|bebida)\b.*$/, "")
    .replace(/\d+\s*x?\s*\d*\s*g\b/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    meatGrams: gramsEach === null ? null : gramsEach * patties,
    patties,
    meatType,
    cut: CUTS.exec(t)?.[1] ?? null,
    isCombo,
    comboExtras: extras,
    baseName
  };
}

export interface ComboPremium {
  combo: string;
  standalone: string;
  /** Combo price − standalone burger price: what the extras cost inside the combo. */
  extrasCents: number;
  extras: string[];
}

/** Pairs each combo with its standalone burger on the same menu (same base name). */
export function comboPremiums(items: ReadonlyArray<{ title: string; priceCents: number }>): ComboPremium[] {
  const read = items.map((item) => ({ ...item, b: readBurger(item.title) }));
  const singles = read.filter((r) => !r.b.isCombo);
  const out: ComboPremium[] = [];
  for (const combo of read.filter((r) => r.b.isCombo)) {
    const single = singles.find((s) => s.b.baseName && s.b.baseName === combo.b.baseName && s.b.meatGrams === combo.b.meatGrams);
    if (single && combo.priceCents > single.priceCents) {
      out.push({ combo: combo.title, standalone: single.title, extrasCents: combo.priceCents - single.priceCents, extras: combo.b.comboExtras });
    }
  }
  return out;
}
