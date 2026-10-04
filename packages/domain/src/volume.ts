/**
 * Deterministic volume parsing for pt-BR delivery titles.
 * Examples: "500ml", "500 mL", "0,5 L", "0.5l", "1 litro", "meio litro".
 */

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function normalizeText(text: string): string {
  return stripAccents(text).toLowerCase().replace(/\s+/g, " ").trim();
}

const ML_RE = /(\d{2,4})\s*(?:ml|mililitros?)\b/;
const LITER_RE = /(\d+(?:[.,]\d{1,3})?)\s*(?:l|lt|lts|litros?)\b/;

export function parseVolumeMl(text: string): number | null {
  const normalized = normalizeText(text);

  if (/\bmeio litro\b/.test(normalized)) return 500;

  const ml = ML_RE.exec(normalized);
  if (ml) return Number.parseInt(ml[1]!, 10);

  const liters = LITER_RE.exec(normalized);
  if (liters) {
    const [whole, fraction = ""] = liters[1]!.replace(",", ".").split(".");
    const ml = Number.parseInt(whole!, 10) * 1000 + Number.parseInt(fraction.padEnd(3, "0"), 10);
    return ml > 0 ? ml : null;
  }

  return null;
}

/** Number of units in a pack/combo title ("2x", "combo 2", "kit com 3"), default 1. */
export function parsePackQuantity(text: string): number {
  const normalized = normalizeText(text);
  const patterns = [
    /\b(\d+)\s*x\b(?!\s*\d)/,
    // "combo 2 açaís" is a pack; "combo 20 peças" / "8 fatias" / "500 ml" are not.
    /\b(?:combo|kit|pack)\s*(?:com\s*)?(\d+)\b(?!\s*(?:pecas|peca|pcs|pc|fatias|ml|l|litros?|g|kg)\b)/,
    /\b(\d+)\s*(?:unidades|copos)\b/
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (match) {
      const quantity = Number.parseInt(match[1]!, 10);
      if (quantity >= 1 && quantity <= 20) return quantity;
    }
  }
  return 1;
}
