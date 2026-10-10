import { parseBRL } from "@nape3/domain";
import { parseAllBRL, type Cents } from "@nape3/domain";
import type { MenuCard, RestaurantSnapshot } from "../../shared/types";
import { amountForLabel, clean, field, findByOwnText, isStruckThrough, isVisible, missing, parseEta, textOf } from "../dom";

/** iFood document titles look like "<Merchant> - <Neighbourhood> ... | iFood" (assumption). */
function merchantFromTitle(title: string): string | null {
  const head = clean(title.split(/\s[|–-]\s/)[0]);
  return head && !/ifood/i.test(head) ? head : null;
}

export function extractRestaurant(doc: Document): RestaurantSnapshot {
  const root = doc.body;
  // On a restaurant page the single page-level <h1> is the merchant name.
  // We never fall back to "the first h2/h3".
  const h1s = Array.from(root.querySelectorAll("h1")).filter(isVisible);
  const fromTitle = merchantFromTitle(doc.title);
  const merchantName =
    h1s.length === 1
      ? field(textOf(h1s[0]!), fromTitle && textOf(h1s[0]!).includes(fromTitle) ? "high" : "medium", "page <h1>")
      : fromTitle
        ? field(fromTitle, "low", "document.title")
        : missing<string>(`ambiguous: ${h1s.length} visible <h1>`);

  const minimumOrderCents = (() => {
    const label = findByOwnText(root, /pedido m[ií]nimo/i)[0];
    const value = label ? parseBRL(textOf(label.parentElement ?? label)) : null;
    return value !== null ? field(value, "high", `"${textOf(label!.parentElement ?? label!)}"`) : missing<number>("pedido mínimo not found");
  })();

  const deliveryFeeCents = amountForLabel(root, /^(taxa de )?entrega$/i, [/pedido m[ií]nimo/i], { allowFree: true });

  const etaLabel = findByOwnText(root, /\d{1,3}\s*[-–]\s*\d{1,3}\s*min/i)[0];
  const eta = etaLabel ? parseEta(textOf(etaLabel)) : null;

  return {
    menu: extractMenu(root),
    merchantName,
    deliveryFeeCents,
    minimumOrderCents: minimumOrderCents as RestaurantSnapshot["minimumOrderCents"],
    eta: eta ? field(eta, "medium", `"${textOf(etaLabel!)}"`) : missing("ETA not found")
  };
}

/**
 * Menu cards (iFood 2026: a.dish-card with __description, __price--discount,
 * __price--original, dish-info-serves). Read-only; duplicates from the
 * "Destaques" carousel are removed by title + price. At most 200 cards.
 */
export function extractMenu(root: Element): MenuCard[] {
  const out: MenuCard[] = [];
  const seen = new Set<string>();
  for (const card of Array.from(root.querySelectorAll('[class~="dish-card"], a[class*="dish-card"]')).slice(0, 400)) {
    const title = clean(textOf(card.querySelector('[class*="dish-card__description"]') ?? card.querySelector("h3") ?? card));
    if (!title) continue;
    const priceBox = card.querySelector('[class*="dish-card__price"]');
    if (!priceBox) continue;
    const current = card.querySelector('[class*="price--discount"]') ?? priceBox;
    const struckEl = card.querySelector('[class*="price--original"]');
    const priceCents = parseAllBRL(textOf(current)).find(() => true) ?? null;
    if (priceCents === null || isStruckThrough(current)) continue;
    const original = struckEl ? (parseAllBRL(textOf(struckEl))[0] ?? null) : null;
    const key = `${title}|${priceCents}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const serves = card.querySelector('[class*="dish-info-serves"]');
    out.push({
      title,
      priceCents: priceCents as Cents,
      originalPriceCents: original as Cents | null,
      servingsText: serves ? clean(textOf(serves)) : null,
      itemId: itemIdOf(card)
    });
    if (out.length >= 200) break;
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The item id in a card link (?prato=<uuid> or ?item=<uuid>); nothing else from the URL is kept. */
function itemIdOf(card: Element): string | null {
  const anchor = card.closest("a[href]") ?? card.querySelector("a[href]");
  const href = anchor?.getAttribute("href");
  if (!href) return null;
  try {
    const url = new URL(href, "https://www.ifood.com.br");
    const id = url.searchParams.get("prato") ?? url.searchParams.get("item");
    return id && UUID.test(id) ? id.toLowerCase() : null;
  } catch {
    return null;
  }
}
