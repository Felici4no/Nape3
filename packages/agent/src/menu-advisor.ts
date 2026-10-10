import { IFOOD_SERVICE_FEE_CENTS, parseVolumeMl, readBurger, type PurchaseIntent, type SourcePlatform } from "@nape3/domain";

/**
 * Menu advisor: answers an intent from the menus the user has already seen
 * (restaurant pages read in their own session). It never replaces the
 * decision engine, which ranks real checkout totals (ADR-004): every answer
 * here is an *estimated* checkout — item × quantity + the shop's delivery fee
 * as shown on its page + the service fee — to be confirmed in the bag.
 */

export interface MenuObservation {
  merchant: { name: string; platformId?: string; path?: string };
  source: SourcePlatform;
  observedAt: string;
  /** Delivery fee shown on the restaurant page; null when not read. */
  deliveryFeeCents: number | null;
  marketRegion?: string;
  items: ReadonlyArray<{ title: string; priceCents: number; originalPriceCents?: number | null }>;
}

export interface MenuCandidate {
  merchantName: string;
  merchantPath: string | null;
  source: SourcePlatform;
  title: string;
  priceCents: number;
  quantity: number;
  deliveryFeeCents: number | null;
  serviceFeeCents: number;
  /** item × quantity + delivery + service; null when the delivery fee is unknown. */
  estimatedTotalCents: number | null;
  /** ml (açaí) or meat grams (burger) of one unit; null when the title does not say. */
  amount: number | null;
  unit: "ml" | "g carne" | null;
  /** Item price per 100 ml / 100 g of meat (menu price, no fees). */
  pricePer100Cents: number | null;
  sizeMatch: boolean;
  ageMinutes: number;
}

export interface MenuAdvice {
  /** Cheapest estimated checkout for exactly what was asked (size, budget). */
  bestForRequest: MenuCandidate | null;
  /** Best price per litre / per 100 g of meat among everything read (may be over budget: see `bestValueOverBudget`). */
  bestValue: MenuCandidate | null;
  bestValueOverBudget: boolean;
  candidates: MenuCandidate[];
  shopsConsidered: number;
  itemsConsidered: number;
  reasoning: string[];
}

export interface MenuAdvisorOptions {
  now: Date;
  maxAgeMinutes?: number;
  marketRegion?: string;
  serviceFeeCents?: number;
}

const brl = (cents: number) => `R$${(cents / 100).toFixed(2).replace(".", ",")}`;
const ACAI = /a[cç]a[ií]/i;
const BURGER = /\b(burger|hamb[uú]rguer|smash|x-?(salada|bacon|tudo|burger|egg))\b/i;

export function adviseFromMenus(intent: PurchaseIntent, menus: readonly MenuObservation[], options: MenuAdvisorOptions): MenuAdvice {
  const maxAge = options.maxAgeMinutes ?? 24 * 60;
  const service = options.serviceFeeCents ?? IFOOD_SERVICE_FEE_CENTS;
  const category = intent.product.category;
  const quantity = Math.max(1, intent.product.quantity);
  const wantedMl = category === "acai" ? intent.product.volumeMl : undefined;
  const max = intent.budget.maxCents;
  const reasoning: string[] = [];
  const candidates: MenuCandidate[] = [];
  const seen = new Set<string>();
  let shops = 0;

  if (category !== "acai" && category !== "burger") {
    return { bestForRequest: null, bestValue: null, bestValueOverBudget: false, candidates, shopsConsidered: 0, itemsConsidered: 0, reasoning: [`menu search covers açaí and burgers for now, not ${category}`] };
  }

  for (const menu of menus) {
    const age = (options.now.getTime() - Date.parse(menu.observedAt)) / 60_000;
    if (!(age >= 0) || age > maxAge) continue;
    if (options.marketRegion && menu.marketRegion && menu.marketRegion !== options.marketRegion) continue;
    shops += 1;
    for (const item of menu.items) {
      const fits = category === "acai" ? ACAI.test(item.title) : BURGER.test(item.title) || readBurger(item.title).meatGrams !== null;
      if (!fits || item.priceCents <= 0) continue;
      const key = `${menu.merchant.platformId ?? menu.merchant.name}|${item.title}|${item.priceCents}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const burger = category === "burger" ? readBurger(item.title) : null;
      const amount = category === "acai" ? parseVolumeMl(item.title) : (burger?.meatGrams ?? null);
      const total = menu.deliveryFeeCents === null ? null : item.priceCents * quantity + menu.deliveryFeeCents + service;
      candidates.push({
        merchantName: menu.merchant.name,
        merchantPath: menu.merchant.path ?? null,
        source: menu.source,
        title: item.title,
        priceCents: item.priceCents,
        quantity,
        deliveryFeeCents: menu.deliveryFeeCents,
        serviceFeeCents: service,
        estimatedTotalCents: total,
        amount,
        unit: amount === null ? null : category === "acai" ? "ml" : "g carne",
        pricePer100Cents: amount ? Math.round((item.priceCents * 100) / amount) : null,
        sizeMatch: wantedMl === undefined ? true : amount !== null && Math.abs(amount - wantedMl) <= wantedMl * 0.1,
        ageMinutes: Math.round(age)
      });
    }
  }

  const inBudget = (c: MenuCandidate) => max === undefined || (c.estimatedTotalCents !== null && c.estimatedTotalCents <= max);
  const byTotal = (a: MenuCandidate, b: MenuCandidate) => (a.estimatedTotalCents ?? Infinity) - (b.estimatedTotalCents ?? Infinity);
  const byValue = (a: MenuCandidate, b: MenuCandidate) => (a.pricePer100Cents ?? Infinity) - (b.pricePer100Cents ?? Infinity) || (b.amount ?? 0) - (a.amount ?? 0);

  const forRequest = candidates.filter((c) => c.sizeMatch && c.estimatedTotalCents !== null && inBudget(c)).sort(byTotal);
  const valued = candidates.filter((c) => c.pricePer100Cents !== null).sort(byValue);
  const bestForRequest = forRequest[0] ?? null;
  const bestValue = valued[0] ?? null;
  const bestValueOverBudget = bestValue !== null && !inBudget(bestValue);

  reasoning.push(`${candidates.length} itens de ${shops} loja(s) lidas nas últimas ${Math.round(maxAge / 60)} h.`);
  const sized = candidates.filter((c) => c.sizeMatch).length;
  if (wantedMl) reasoning.push(`Tamanho pedido: ${wantedMl} ml (±10%). ${sized} ${sized === 1 ? "item" : "itens"} desse tamanho.`);
  if (max !== undefined) reasoning.push(`Orçamento: até ${brl(max)} no total estimado.`);
  reasoning.push(`Total estimado = item × ${quantity} + frete da loja + taxa de serviço ${brl(service)}; confirme na sacola.`);
  if (bestForRequest) reasoning.push(`Mais barato no tamanho pedido: ${bestForRequest.title} em ${bestForRequest.merchantName}, ${brl(bestForRequest.estimatedTotalCents!)} estimado.`);
  else reasoning.push("Nenhum item do tamanho pedido cabe no orçamento entre as lojas lidas.");
  if (bestValue) {
    reasoning.push(`Melhor custo por ${bestValue.unit === "ml" ? "litro" : "100 g de carne"}: ${bestValue.title} em ${bestValue.merchantName}, ${brl(bestValue.pricePer100Cents! * (bestValue.unit === "ml" ? 10 : 1))}${bestValue.unit === "ml" ? "/L" : "/100 g"}${bestValueOverBudget ? " (acima do orçamento no total estimado)" : ""}.`);
  }
  if (bestForRequest && bestValue && bestValue !== bestForRequest && bestValue.amount && bestForRequest.amount && bestForRequest.pricePer100Cents) {
    const cheaper = Math.round(((bestForRequest.pricePer100Cents - bestValue.pricePer100Cents!) / bestForRequest.pricePer100Cents) * 1000) / 10;
    if (cheaper > 0) reasoning.push(`Levando ${bestValue.amount} ${bestValue.unit} em vez de ${bestForRequest.amount}, cada 100 sai ${cheaper.toLocaleString("pt-BR")}% mais barato.`);
  }
  return { bestForRequest, bestValue, bestValueOverBudget, candidates: [...candidates].sort(byTotal), shopsConsidered: shops, itemsConsidered: candidates.length, reasoning };
}
