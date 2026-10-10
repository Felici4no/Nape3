import { parseAllBRL } from "./money";

/**
 * Readers for the plain text an agent sees on a delivery page (copied text,
 * accessibility tree, "get page text"). Deterministic and conservative: an
 * item needs a title and a price on its own line; anything unclear is skipped.
 */

export interface MenuTextItem {
  title: string;
  priceBrl: number;
  originalPriceBrl: number | null;
  servingsText: string | null;
}

export interface MenuTextReading {
  items: MenuTextItem[];
  deliveryFeeBrl: number | null;
  minimumOrderBrl: number | null;
  skippedBlocks: number;
}

const PRICE_LINE = /^(?:a partir de\s+)?R\$\s?\d{1,4}(?:\.\d{3})*,\d{2}$/i;
const SERVES = /^serve\s+(?:at[eé]\s+)?\d{1,2}\s+pessoas?$/i;
const TAG = /^(vegetariano|vegano|natural|sem gl[uú]ten|sem lactose|picante|org[aâ]nico|novo|mais pedido|promo(?:[cç][aã]o)?|item promocional|kids|fit|zero|light|gelado|quente)$/i;
const FREE = /^gr[aá]tis$/i;

const brl = (line: string) => {
  const cents = parseAllBRL(line)[0];
  return cents === undefined ? null : cents / 100;
};
const isDescription = (line: string) => line.length > 70 || (line.length > 40 && /[.!?]$/.test(line));

export function readMenuText(text: string): MenuTextReading {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  let deliveryFeeBrl: number | null = null;
  let minimumOrderBrl: number | null = null;
  const items: MenuTextItem[] = [];
  let skippedBlocks = 0;
  let blockStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Shop-level fees, before or between menu blocks.
    if (/^(taxa de )?entrega$/i.test(line) && deliveryFeeBrl === null) {
      for (const next of lines.slice(i + 1, i + 5)) {
        if (FREE.test(next)) { deliveryFeeBrl = 0; break; }
        if (PRICE_LINE.test(next)) { deliveryFeeBrl = brl(next); break; }
      }
    }
    const minimum = /^pedido m[ií]nimo\s*(R\$\s?[\d.,]+)?$/i.exec(line);
    if (minimum) minimumOrderBrl = minimum[1] ? brl(minimum[1]) : (PRICE_LINE.test(lines[i + 1] ?? "") ? brl(lines[i + 1]!) : null);

    if (!PRICE_LINE.test(line)) continue;
    // A block's prices: current, then an optional higher struck price.
    const price = brl(line)!;
    let original: number | null = null;
    let end = i;
    if (PRICE_LINE.test(lines[i + 1] ?? "") && (brl(lines[i + 1]!) ?? 0) > price) {
      original = brl(lines[i + 1]!);
      end = i + 1;
    }
    const block = lines.slice(blockStart, i);
    blockStart = end + 1;
    const servings = block.find((l) => SERVES.test(l)) ?? null;
    const content = block.filter((l) => !SERVES.test(l) && !TAG.test(l) && !PRICE_LINE.test(l) && !FREE.test(l));
    const firstDescription = content.findIndex(isDescription);
    const candidates = (firstDescription >= 0 ? content.slice(0, firstDescription) : content).filter((l) => !isDescription(l) && l.length <= 120);
    // The title is the most item-like line before the description: a size ("700ml", "180g") or the
    // menu's leading "*"/"." wins; otherwise the line right before the description (section headers come first).
    const score = (l: string) => (/\d+\s*(ml|l|litros?|g|kg)\b/i.test(l) ? 2 : 0) + (/^[*.]/.test(l) ? 1 : 0);
    const title = candidates.reduce<string | undefined>((best, l) => (best === undefined || score(l) >= score(best) ? l : best), undefined);
    if (!title || /^(entrega|hoje|amanh[aã]|retirada|destaques|card[aá]pio|ver mais)$/i.test(title) || /^\d{1,2}:\d{2}/.test(title)) {
      skippedBlocks += 1;
      i = end;
      continue;
    }
    items.push({ title, priceBrl: price, originalPriceBrl: original, servingsText: servings });
    i = end;
  }
  return { items, deliveryFeeBrl, minimumOrderBrl, skippedBlocks };
}

export interface BagTextReading {
  lines: Array<{ quantity: number; title: string; totalBrl: number | null }>;
  subtotalBrl: number | null;
  deliveryFeeBrl: number | null;
  serviceFeeBrl: number | null;
  discountBrl: number | null;
  totalBrl: number | null;
  /** subtotal + delivery + service − discount equals the total (±R$0,01). */
  reconciles: boolean | null;
}

const LABELS: Array<[keyof Omit<BagTextReading, "lines" | "reconciles">, RegExp]> = [
  ["subtotalBrl", /^subtotal:?/i],
  ["deliveryFeeBrl", /^taxa de entrega:?/i],
  ["serviceFeeBrl", /^taxa de servi[cç]o:?/i],
  ["discountBrl", /^(desconto|cupom|descontos?)\b/i],
  ["totalBrl", /^total(?: a pagar| do pedido)?:?/i]
];

export function readBagText(text: string): BagTextReading {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const out: BagTextReading = { lines: [], subtotalBrl: null, deliveryFeeBrl: null, serviceFeeBrl: null, discountBrl: null, totalBrl: null, reconciles: null };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const label = LABELS.find(([, re]) => re.test(line));
    if (label && out[label[0]] === null) {
      const rest = line.replace(label[1], "").replace(/\?/g, "").trim();
      const value = FREE.test(rest) ? 0 : rest ? brl(rest) : null;
      const next = lines[i + 1] ?? "";
      out[label[0]] = value ?? (FREE.test(next) ? 0 : PRICE_LINE.test(next.replace(/^-\s*/, "")) ? brl(next) : null);
      continue;
    }
    const item = /^(\d{1,2})\s*x\s+(.+?)(?:\s+(R\$\s?[\d.,]+))?$/i.exec(line);
    if (item) {
      const total = item[3] ? brl(item[3]) : PRICE_LINE.test(lines[i + 1] ?? "") ? brl(lines[i + 1]!) : null;
      out.lines.push({ quantity: Number(item[1]), title: item[2]!.trim(), totalBrl: total });
    }
  }
  if (out.subtotalBrl !== null && out.totalBrl !== null) {
    const sum = out.subtotalBrl + (out.deliveryFeeBrl ?? 0) + (out.serviceFeeBrl ?? 0) - Math.abs(out.discountBrl ?? 0);
    out.reconciles = Math.abs(sum - out.totalBrl) <= 0.011;
  }
  return out;
}
