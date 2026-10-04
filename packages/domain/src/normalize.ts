import type { CanonicalProduct, ProductCategory } from "./types";
import { normalizeText, parsePackQuantity, parseVolumeMl } from "./volume";

const ACAI_RE = /\bacai\b/;

/** Açaí products that are not a ready-to-eat cup/bowl and must not be compared. */
const ACAI_EXCLUSIONS: Array<[RegExp, string]> = [
  [/\bpolpa\b/, "frozen pulp is not a ready-to-eat serving"],
  [/\bpicole\b/, "popsicle is a different product"],
  [/\bsuco\b/, "juice is a different product"],
  [/\bkg\b|\bquilo\b/, "sold by weight, not by serving"]
];

export interface NormalizationResult {
  product: CanonicalProduct | null;
  reasons: string[];
}

/**
 * Deterministic normalizer for the açaí wedge. It never guesses: missing
 * volume lowers confidence; exclusions return `product: null` with a reason.
 */
export function normalizeTitle(sourceTitle: string): NormalizationResult {
  const text = normalizeText(sourceTitle);

  if (!ACAI_RE.test(text)) {
    return { product: null, reasons: ["category not recognized (only açaí is supported)"] };
  }

  for (const [pattern, reason] of ACAI_EXCLUSIONS) {
    if (pattern.test(text)) return { product: null, reasons: [`excluded: ${reason}`] };
  }

  const reasons = ["category açaí matched in title"];
  const attributes: CanonicalProduct["attributes"] = {};
  const volumeMl = parseVolumeMl(sourceTitle);
  const pack = parsePackQuantity(sourceTitle);

  if (volumeMl !== null) reasons.push(`volume ${volumeMl} ml parsed from title`);
  else reasons.push("volume not found in title");

  if (pack > 1) {
    attributes.packQuantity = pack;
    reasons.push(`pack of ${pack} detected`);
  }
  if (/\b(zero|sem acucar)\b/.test(text)) attributes.sugarFree = true;
  if (/\bbarca\b/.test(text)) attributes.format = "barca";
  else if (/\btigela\b/.test(text)) attributes.format = "tigela";
  else if (/\bcopo\b/.test(text)) attributes.format = "copo";

  const product: CanonicalProduct = {
    category: "acai",
    attributes,
    normalization: {
      method: "deterministic",
      confidence: volumeMl !== null ? 0.95 : 0.4,
      reasons
    }
  };
  if (volumeMl !== null) product.volumeMl = volumeMl;

  return { product, reasons };
}

export interface EquivalenceResult {
  equivalent: boolean;
  reasons: string[];
}

export interface ProductRequirement {
  category: ProductCategory;
  volumeMl?: number;
}

/**
 * Is `product` a match for the requirement? Volume must be equal when the
 * requirement specifies one. Packs never match a single-unit requirement.
 */
export function matchesRequirement(
  product: CanonicalProduct | null,
  requirement: ProductRequirement
): EquivalenceResult {
  if (!product) return { equivalent: false, reasons: ["product could not be normalized"] };
  if (product.category !== requirement.category) {
    return { equivalent: false, reasons: [`category ${product.category} ≠ ${requirement.category}`] };
  }
  const pack = Number(product.attributes.packQuantity ?? 1);
  if (pack !== 1) return { equivalent: false, reasons: [`pack of ${pack} is not a single serving`] };

  if (requirement.volumeMl !== undefined) {
    if (product.volumeMl === undefined) {
      return { equivalent: false, reasons: ["volume unknown; cannot confirm equivalence"] };
    }
    if (product.volumeMl !== requirement.volumeMl) {
      return {
        equivalent: false,
        reasons: [`volume ${product.volumeMl} ml ≠ required ${requirement.volumeMl} ml`]
      };
    }
  }
  return {
    equivalent: true,
    reasons: [
      `category ${product.category}` +
        (requirement.volumeMl !== undefined ? `, volume ${requirement.volumeMl} ml` : "") +
        " match"
    ]
  };
}

export function areEquivalent(a: CanonicalProduct | null, b: CanonicalProduct | null): EquivalenceResult {
  if (!a || !b) return { equivalent: false, reasons: ["one of the products could not be normalized"] };
  if (a.category !== b.category) return { equivalent: false, reasons: [`category ${a.category} ≠ ${b.category}`] };
  if (a.volumeMl === undefined || b.volumeMl === undefined) {
    return { equivalent: false, reasons: ["volume unknown; cannot confirm equivalence"] };
  }
  if (a.volumeMl !== b.volumeMl) {
    return { equivalent: false, reasons: [`volume ${a.volumeMl} ml ≠ ${b.volumeMl} ml`] };
  }
  const aPack = Number(a.attributes.packQuantity ?? 1);
  const bPack = Number(b.attributes.packQuantity ?? 1);
  if (aPack !== bPack) return { equivalent: false, reasons: [`pack ${aPack} ≠ pack ${bPack}`] };
  return { equivalent: true, reasons: [`same category, ${a.volumeMl} ml, pack ${aPack}`] };
}
