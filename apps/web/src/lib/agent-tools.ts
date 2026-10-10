import { adviseFromMenus, parseIntent, type MenuObservation } from "@nape3/agent";
import { comboPremiums, costInsights, liquidValue, menuValue, priceLayers, readBagText, readBurger, readMenuText } from "@nape3/domain";

/**
 * UPAY3FOOD for other agents: the same pure calculations the extension uses,
 * exposed with reais in and reais out. Stateless — nothing is stored, nothing
 * is fetched from any platform; the agent brings what it read.
 */

export const METHODOLOGY_URL = "https://docs.upay3food.com/docs/05-architecture/price-calculations";

const toCents = (brl: number | null | undefined) => (brl === null || brl === undefined ? null : Math.round(brl * 100));
const toBrl = (cents: number | null | undefined) => (cents === null || cents === undefined ? null : Math.round(cents) / 100);

export function priceBreakdown(input: {
  food_brl: number;
  delivery_fee_brl?: number | null;
  service_fee_brl?: number | null;
  discount_brl?: number | null;
  total_brl?: number | null;
  cheapest_comparable_brl?: number | null;
}) {
  const l = priceLayers({
    foodCents: toCents(input.food_brl)!,
    deliveryFeeCents: toCents(input.delivery_fee_brl),
    serviceFeeCents: toCents(input.service_fee_brl),
    discountCents: toCents(input.discount_brl),
    totalCents: toCents(input.total_brl),
    cheapestComparableCents: toCents(input.cheapest_comparable_brl)
  });
  return {
    layers: { food_brl: toBrl(l.foodCents), fees_brl: toBrl(l.feesCents), difference_brl: toBrl(l.overpayCents) },
    delivery_fee_brl: toBrl(l.deliveryFeeCents),
    service_fee_brl: toBrl(l.serviceFeeCents),
    discount_brl: toBrl(l.discountCents),
    total_brl: toBrl(l.totalCents),
    fee_share_pct: l.feeSharePct,
    estimated: l.estimated,
    notes: l.notes,
    methodology: METHODOLOGY_URL
  };
}

export function itemCost(input: { title: string; price_brl: number; original_price_brl?: number | null; servings_text?: string | null; fees_brl?: number | null }) {
  const c = costInsights({
    title: input.title,
    priceCents: toCents(input.price_brl)!,
    originalPriceCents: toCents(input.original_price_brl),
    servingsText: input.servings_text ?? null,
    feesCents: toCents(input.fees_brl)
  });
  const burger = readBurger(input.title);
  return {
    volume_ml: c.volumeMl,
    weight_g: c.weightG,
    price_per_100ml_brl: toBrl(c.pricePer100mlCents),
    price_per_liter_brl: toBrl(c.pricePerLiterCents),
    price_per_100g_brl: toBrl(c.pricePer100gCents),
    real_price_per_100ml_with_fees_brl: toBrl(c.effectivePer100mlCents),
    fees_as_product_ml: c.feesAsProductMl,
    fees_as_product_g: c.feesAsProductG,
    servings: c.servings,
    total_per_serving_brl: toBrl(c.totalPerServingCents),
    shown_discount_pct: c.discountPct,
    shown_discount_brl: toBrl(c.discountCents),
    burger: burger.meatGrams !== null || burger.isCombo ? { meat_g: burger.meatGrams, patties: burger.patties, meat_type: burger.meatType, cut: burger.cut, is_combo: burger.isCombo, combo_extras: burger.comboExtras } : null,
    methodology: METHODOLOGY_URL
  };
}

export function rankMenu(input: { items: Array<{ title: string; price_brl: number }>; kind?: "auto" | "acai" | "burger" | "drinks" }) {
  const items = input.items.map((i) => ({ title: i.title, priceCents: toCents(i.price_brl)! }));
  const acai = items.filter((i) => /a[cç]a[ií]/i.test(i.title));
  const burgers = items.filter((i) => readBurger(i.title).meatGrams !== null || readBurger(i.title).isCombo);
  const kind = input.kind && input.kind !== "auto" ? input.kind : acai.length >= 2 ? "acai" : burgers.length >= 2 ? "burger" : "drinks";
  const row = (r: { title: string; priceCents: number; volumeMl: number; pricePer100mlCents: number }) => ({ title: r.title, price_brl: toBrl(r.priceCents), amount: r.volumeMl, price_per_100_brl: toBrl(r.pricePer100mlCents) });
  if (kind === "acai" || kind === "burger") {
    const v = menuValue(kind === "acai" ? acai : burgers, kind === "acai" ? "volume" : "meat");
    return {
      kind,
      unit: kind === "acai" ? "ml" : "g of meat",
      ranked: v.ranked.map(row),
      spread_pct: v.spreadPct,
      unranked: v.unranked,
      bulk_best: v.bulkBest ? row(v.bulkBest) : null,
      combo_premiums: kind === "burger" ? comboPremiums(burgers).map((c) => ({ combo: c.combo, standalone: c.standalone, extras: c.extras, extras_cost_brl: toBrl(c.extrasCents) })) : [],
      drinks: liquidValue(items).filter((g) => g.kind !== "acai").map(drinkGroup),
      methodology: METHODOLOGY_URL
    };
  }
  return { kind: "drinks", drinks: liquidValue(items).map(drinkGroup), methodology: METHODOLOGY_URL };
}

function drinkGroup(g: ReturnType<typeof liquidValue>[number]) {
  return {
    kind: g.kind,
    label: g.label,
    spread_pct: g.spreadPct,
    ranked: g.ranked.map((i) => ({ title: i.title, price_brl: toBrl(i.priceCents), units: i.units, total_ml: i.totalMl, price_per_liter_brl: toBrl(i.pricePerLiterCents) }))
  };
}

const IFOOD_PATH = /^\/delivery\/([a-z0-9-]+)\/([a-z0-9-]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads an iFood shop/item link. Only the public path and the item id are kept; any other query value is dropped. */
export function parseIfoodLink(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false as const, error: "not a URL" };
  }
  if (!/(^|\.)ifood\.com\.br$/i.test(u.hostname)) return { ok: false as const, error: "not an ifood.com.br link" };
  const m = IFOOD_PATH.exec(u.pathname);
  if (!m) return { ok: false as const, error: "not a shop link (/delivery/<city>/<shop>/<id>)" };
  const item = u.searchParams.get("prato") ?? u.searchParams.get("item");
  const path = `/delivery/${m[1]!.toLowerCase()}/${m[2]!.toLowerCase()}/${m[3]!.toLowerCase()}`;
  return {
    ok: true as const,
    platform: "ifood",
    city: m[1]!.toLowerCase(),
    shop_slug: m[2]!.toLowerCase(),
    shop_id: m[3]!.toLowerCase(),
    item_id: item && UUID.test(item) ? item.toLowerCase() : null,
    shop_url: `https://www.ifood.com.br${path}`
  };
}

export interface AdviseMenuInput {
  merchant_name: string;
  merchant_url?: string | null;
  delivery_fee_brl: number | null;
  observed_at?: string | null;
  items: Array<{ title: string; price_brl: number; item_url?: string | null }>;
}

export function advise(input: { request: string; menus: AdviseMenuInput[]; now?: Date }) {
  const parsed = parseIntent(input.request);
  if (!parsed.ok) return { ok: false as const, error: parsed.reason };
  const now = input.now ?? new Date();
  const menus: MenuObservation[] = input.menus.map((m) => {
    const link = m.merchant_url ? parseIfoodLink(m.merchant_url) : null;
    return {
      merchant: { name: m.merchant_name, ...(link?.ok ? { platformId: link.shop_id, path: new URL(link.shop_url).pathname } : {}) },
      source: "ifood",
      observedAt: m.observed_at ?? now.toISOString(),
      deliveryFeeCents: toCents(m.delivery_fee_brl),
      items: m.items.map((i) => {
        const itemLink = i.item_url ? parseIfoodLink(i.item_url) : null;
        return { title: i.title, priceCents: toCents(i.price_brl)!, itemId: itemLink?.ok ? itemLink.item_id : null };
      })
    };
  });
  const a = adviseFromMenus(parsed.intent, menus, { now });
  const view = (c: (typeof a)["bestForRequest"]) =>
    c && {
      title: c.title,
      shop: c.merchantName,
      price_brl: toBrl(c.priceCents),
      quantity: c.quantity,
      delivery_fee_brl: toBrl(c.deliveryFeeCents),
      service_fee_brl: toBrl(c.serviceFeeCents),
      estimated_total_brl: toBrl(c.estimatedTotalCents),
      amount: c.amount,
      unit: c.unit,
      price_per_100_brl: toBrl(c.pricePer100Cents),
      link: c.itemUrl ?? (c.merchantPath ? `https://www.ifood.com.br${c.merchantPath}` : null),
      bulk: c.bulk
    };
  return {
    ok: true as const,
    estimate: true,
    best_for_request: view(a.bestForRequest),
    nearest_size: view(a.nearest),
    best_value: view(a.bestValue),
    best_value_over_budget: a.bestValueOverBudget,
    bulk_best: view(a.bulkBest),
    shops: a.shopsConsidered,
    items: a.itemsConsidered,
    reasoning: a.reasoning,
    caveat: "Estimated checkout from menu prices plus the shop's delivery fee and R$0,99 service fee. Coupons, membership and address change prices: confirm in the bag. Never an offer.",
    methodology: METHODOLOGY_URL
  };
}

/** Page text an agent read (shop page) → structured menu, ready for `advise` and `rank_menu`. */
export function readMenuFromText(input: { text: string; shop_name?: string | null; shop_url?: string | null }) {
  const r = readMenuText(input.text);
  const link = input.shop_url ? parseIfoodLink(input.shop_url) : null;
  const menu = {
    merchant_name: input.shop_name ?? "loja",
    merchant_url: link?.ok ? link.shop_url : null,
    delivery_fee_brl: r.deliveryFeeBrl,
    items: r.items.map((i) => ({ title: i.title, price_brl: i.priceBrl, original_price_brl: i.originalPriceBrl, servings_text: i.servingsText }))
  };
  return {
    menu,
    minimum_order_brl: r.minimumOrderBrl,
    items_read: r.items.length,
    blocks_skipped: r.skippedBlocks,
    summary: r.items.length ? rankMenu({ items: r.items.map((i) => ({ title: i.title, price_brl: i.priceBrl })) }) : null,
    next: "Pass `menu` (one per shop) to `advise` with the user's request.",
    methodology: METHODOLOGY_URL
  };
}

/** Bag/checkout text → the three layers, checked against the total. */
export function readBagFromText(input: { text: string; cheapest_comparable_brl?: number | null }) {
  const b = readBagText(input.text);
  return {
    lines: b.lines.map((l) => ({ quantity: l.quantity, title: l.title, total_brl: l.totalBrl })),
    reconciles: b.reconciles,
    breakdown:
      b.subtotalBrl === null
        ? null
        : priceBreakdown({
            food_brl: b.subtotalBrl,
            delivery_fee_brl: b.deliveryFeeBrl,
            service_fee_brl: b.serviceFeeBrl,
            discount_brl: b.discountBrl === null ? null : Math.abs(b.discountBrl),
            total_brl: b.totalBrl,
            cheapest_comparable_brl: input.cheapest_comparable_brl ?? null
          }),
    warning: b.subtotalBrl === null || b.totalBrl === null ? "subtotal or total not found in the text" : b.reconciles === false ? "the parts do not add up to the total; check the text" : null
  };
}

/**
 * Several real bags for the same purchase (other shops or platforms): ranked by total,
 * each with its three layers, where layer 3 is the difference to the cheapest bag.
 */
export function compareBags(input: {
  bags: Array<{ label: string; food_brl: number; delivery_fee_brl?: number | null; service_fee_brl?: number | null; discount_brl?: number | null; total_brl: number; link?: string | null }>;
}) {
  const cheapest = Math.min(...input.bags.map((b) => b.total_brl));
  const rows = input.bags
    .map((b) => ({ label: b.label, link: b.link ?? null, ...priceBreakdown({ ...b, cheapest_comparable_brl: cheapest }) }))
    .sort((a, b) => (a.total_brl ?? 0) - (b.total_brl ?? 0));
  const best = rows[0]!;
  const worst = rows[rows.length - 1]!;
  return {
    best: { label: best.label, total_brl: best.total_brl, link: best.link },
    spread_brl: toBrl(Math.round(((worst.total_brl ?? 0) - (best.total_brl ?? 0)) * 100)),
    bags: rows,
    note: "Compare bags with the same items and quantities. Totals depend on each account's coupons, membership and address.",
    methodology: METHODOLOGY_URL
  };
}

export const METHODOLOGY_TEXT = `UPAY3FOOD methodology (summary)
- "Você paga 3 vezes": food + fees (delivery + service) + the difference to the cheapest real, fresh comparable observation.
- Per 100 ml / litre from the title volume; drinks packs count every unit ("269ml com 15un"); for açaí "2x" means toppings.
- Bulk (pote, balde, caixa, ≥ 1,5 L) is kept apart from cup sizes.
- Burgers: meat grams from the title ("2x 90g" = 180 g), price per 100 g of meat, combo extras = combo − standalone burger.
- Advice from menus is an estimate: item × quantity + shop delivery fee + R$0,99 service fee. Never an offer; confirm in the bag.
- Never claimed: that a price is available to another account, causes of differences, comparisons on synthetic or stale data.
Full text: ${METHODOLOGY_URL}`;
