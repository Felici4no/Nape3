import type { CanonicalProduct, PizzaSize, ProductCategory } from "./types";
import { normalizeText, parsePackQuantity, parseVolumeMl } from "./volume";

export interface NormalizationResult {
  product: CanonicalProduct | null;
  reasons: string[];
}

/**
 * Deterministic normalizers, one per category. They never guess: a missing
 * comparison key (volume, size, pieces) lowers confidence; exclusions return
 * `product: null` with a reason.
 *
 * Comparison key per category:
 *   açaí → volumeMl · pizza → size · sushi → pieces · burger → none (loose)
 */

const CATEGORY_RES: Array<[ProductCategory, RegExp]> = [
  ["acai", /\bacai\b/],
  ["sushi", /\b(sushi|combinado|sashimi|uramaki|hossomaki|niguiri|nigiri)\b/],
  ["pizza", /\bpizzas?\b/],
  ["burger", /\b(hamburguer|hamburger|burger|cheeseburger|smash|x[- ]?(burger|salada|bacon|tudo|egg))\b/]
];

const EXCLUSIONS: Record<ProductCategory, Array<[RegExp, string]>> = {
  acai: [
    [/\bpolpa\b/, "frozen pulp is not a ready-to-eat serving"],
    [/\bpicole\b/, "popsicle is a different product"],
    [/\bsuco\b/, "juice is a different product"],
    [/\bkg\b|\bquilo\b/, "sold by weight, not by serving"]
  ],
  burger: [
    [/\b(combo|\+\s*(batata|fritas|refri)|com (batata|fritas)|e refri)\b/, "combo with sides is not a single burger"],
    [/\b(kit|caixa)\b/, "kit/box is not a single burger"]
  ],
  pizza: [
    [/\b(esfiha|esfirra|calzone)\b/, "different product"],
    [/\bfatia\b(?!s)/, "single slice is not a whole pizza"]
  ],
  sushi: [[/\btemaki\b/, "temaki is a single cone, not a combo"]]
};

export function parsePizzaSize(text: string): PizzaSize | null {
  const t = normalizeText(text);
  if (/\b(broto|pequena|mini|individual)\b/.test(t) || /\b4 fatias\b/.test(t)) return "broto";
  if (/\b(familia|gigante|big)\b/.test(t) || /\b(12|16) fatias\b/.test(t)) return "familia";
  if (/\bgrande\b/.test(t) || /\b8 fatias\b/.test(t)) return "grande";
  if (/\bmedia\b/.test(t) || /\b6 fatias\b/.test(t)) return "media";
  return null;
}

export function parseSushiPieces(text: string): number | null {
  const match = /\b(\d{1,3})\s*(pecas|peca|pcs|pc|unidades)\b/.exec(normalizeText(text));
  if (!match) return null;
  const pieces = Number.parseInt(match[1]!, 10);
  return pieces >= 4 && pieces <= 200 ? pieces : null;
}

export function detectCategory(text: string): ProductCategory | null {
  const t = normalizeText(text);
  return CATEGORY_RES.find(([, re]) => re.test(t))?.[0] ?? null;
}

export function normalizeTitle(sourceTitle: string): NormalizationResult {
  const text = normalizeText(sourceTitle);
  const category = detectCategory(sourceTitle);
  if (!category) {
    return { product: null, reasons: ["category not recognized (supported: açaí, burger, pizza, sushi)"] };
  }
  for (const [pattern, reason] of EXCLUSIONS[category]) {
    if (pattern.test(text)) return { product: null, reasons: [`excluded: ${reason}`] };
  }

  const reasons = [`category ${category} matched in title`];
  const attributes: CanonicalProduct["attributes"] = {};
  const pack = parsePackQuantity(sourceTitle);
  if (pack > 1) {
    attributes.packQuantity = pack;
    reasons.push(`pack of ${pack} detected`);
  }
  const product: CanonicalProduct = {
    category,
    attributes,
    normalization: { method: "deterministic", confidence: 0.4, reasons }
  };

  switch (category) {
    case "acai": {
      const volumeMl = parseVolumeMl(sourceTitle);
      if (volumeMl !== null) {
        product.volumeMl = volumeMl;
        reasons.push(`volume ${volumeMl} ml parsed from title`);
        product.normalization.confidence = 0.95;
      } else reasons.push("volume not found in title");
      if (/\b(zero|sem acucar)\b/.test(text)) attributes.sugarFree = true;
      if (/\bbarca\b/.test(text)) attributes.format = "barca";
      else if (/\btigela\b/.test(text)) attributes.format = "tigela";
      else if (/\bcopo\b/.test(text)) attributes.format = "copo";
      break;
    }
    case "pizza": {
      const size = parsePizzaSize(sourceTitle);
      if (size) {
        product.size = size;
        reasons.push(`size ${size} parsed from title`);
        product.normalization.confidence = 0.85;
      } else reasons.push("pizza size not found in title");
      break;
    }
    case "sushi": {
      const pieces = parseSushiPieces(sourceTitle);
      if (pieces !== null) {
        product.pieces = pieces;
        reasons.push(`${pieces} pieces parsed from title`);
        product.normalization.confidence = 0.85;
      } else reasons.push("piece count not found in title");
      break;
    }
    case "burger": {
      reasons.push("single burger; variants (smash, gourmet, x-salada) are only loosely comparable");
      product.normalization.confidence = 0.6;
      break;
    }
  }
  return { product, reasons };
}

export interface EquivalenceResult {
  equivalent: boolean;
  reasons: string[];
}

export interface ProductRequirement {
  category: ProductCategory;
  volumeMl?: number;
  size?: PizzaSize;
  pieces?: number;
}

/** Human label of the comparison key, e.g. "volume 500 ml". */
export function describeRequirement(requirement: ProductRequirement): string {
  const parts: string[] = [requirement.category];
  if (requirement.volumeMl !== undefined) parts.push(`${requirement.volumeMl} ml`);
  if (requirement.size !== undefined) parts.push(requirement.size);
  if (requirement.pieces !== undefined) parts.push(`${requirement.pieces} pieces`);
  return parts.join(" ");
}

type KeyName = "volumeMl" | "size" | "pieces";
const KEY_LABEL: Record<KeyName, (v: unknown) => string> = {
  volumeMl: (v) => `volume ${String(v)} ml`,
  size: (v) => `size ${String(v)}`,
  pieces: (v) => `${String(v)} pieces`
};

/**
 * Is `product` a match for the requirement? Every key the requirement states
 * (volume, size, pieces) must be known and equal. Packs never match a
 * single-unit requirement.
 */
export function matchesRequirement(product: CanonicalProduct | null, requirement: ProductRequirement): EquivalenceResult {
  if (!product) return { equivalent: false, reasons: ["product could not be normalized"] };
  if (product.category !== requirement.category) {
    return { equivalent: false, reasons: [`category ${product.category} ≠ ${requirement.category}`] };
  }
  const pack = Number(product.attributes.packQuantity ?? 1);
  if (pack !== 1) return { equivalent: false, reasons: [`pack of ${pack} is not a single serving`] };

  for (const key of ["volumeMl", "size", "pieces"] as const) {
    const wanted = requirement[key];
    if (wanted === undefined) continue;
    const actual = product[key];
    const label = key === "volumeMl" ? "volume" : key === "size" ? "size" : "piece count";
    if (actual === undefined) return { equivalent: false, reasons: [`${label} unknown; cannot confirm equivalence`] };
    if (actual !== wanted) {
      const unit = key === "volumeMl" ? " ml" : key === "pieces" ? " pieces" : "";
      return { equivalent: false, reasons: [`${label} ${String(actual)}${unit} ≠ required ${String(wanted)}${unit}`] };
    }
  }
  return { equivalent: true, reasons: [`${describeRequirement(requirement)} match`] };
}

/** The comparison key of a product's category, as a requirement. */
export function requirementOf(product: CanonicalProduct): ProductRequirement {
  const requirement: ProductRequirement = { category: product.category };
  if (product.volumeMl !== undefined) requirement.volumeMl = product.volumeMl;
  if (product.size !== undefined) requirement.size = product.size;
  if (product.pieces !== undefined) requirement.pieces = product.pieces;
  return requirement;
}

const KEY_OF: Record<ProductCategory, KeyName | null> = { acai: "volumeMl", pizza: "size", sushi: "pieces", burger: null };

export function areEquivalent(a: CanonicalProduct | null, b: CanonicalProduct | null): EquivalenceResult {
  if (!a || !b) return { equivalent: false, reasons: ["one of the products could not be normalized"] };
  if (a.category !== b.category) return { equivalent: false, reasons: [`category ${a.category} ≠ ${b.category}`] };
  const key = KEY_OF[a.category];
  if (key) {
    if (a[key] === undefined || b[key] === undefined) {
      return { equivalent: false, reasons: [`${key === "volumeMl" ? "volume" : key} unknown; cannot confirm equivalence`] };
    }
    if (a[key] !== b[key]) {
      return {
        equivalent: false,
        reasons: [key === "volumeMl" ? `volume ${a.volumeMl} ml ≠ ${b.volumeMl} ml` : `${KEY_LABEL[key](a[key])} ≠ ${KEY_LABEL[key](b[key])}`]
      };
    }
  }
  const aPack = Number(a.attributes.packQuantity ?? 1);
  const bPack = Number(b.attributes.packQuantity ?? 1);
  if (aPack !== bPack) return { equivalent: false, reasons: [`pack ${aPack} ≠ pack ${bPack}`] };
  return {
    equivalent: true,
    reasons: [key === "volumeMl" ? `same category, ${a.volumeMl} ml, pack ${aPack}` : `same ${describeRequirement(requirementOf(a))}, pack ${aPack}`]
  };
}
