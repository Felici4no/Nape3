import type { MenuAdvice } from "@nape3/agent";

/**
 * Local usage numbers (this browser only, never sent anywhere by itself):
 * how many shops and items were read, searches answered, and the estimated
 * saving of each recommendation against the median of the same-size options
 * read. The user can copy them to share; nothing personal is included.
 */
export interface UsageStats {
  since: string;
  shops: string[];
  itemsRead: number;
  searches: number;
  recommendations: number;
  /** Sum of estimated savings (cents) of recommendations vs the median same-size option. */
  savingsCents: number;
  bestSavingCents: number;
}

export const emptyUsage = (now = new Date()): UsageStats => ({ since: now.toISOString(), shops: [], itemsRead: 0, searches: 0, recommendations: 0, savingsCents: 0, bestSavingCents: 0 });

export function recordShop(stats: UsageStats, shopKey: string, items: number): UsageStats {
  if (stats.shops.includes(shopKey)) return stats;
  return { ...stats, shops: [...stats.shops, shopKey].slice(-500), itemsRead: stats.itemsRead + items };
}

/** Estimated saving of the pick vs the median estimated total of options of the same size (null without ≥ 2). */
export function adviceSavingCents(advice: MenuAdvice): number | null {
  const pick = advice.bestForRequest;
  if (!pick || pick.estimatedTotalCents === null || pick.amount === null) return null;
  const same = advice.candidates
    .filter((c) => c.amount === pick.amount && c.estimatedTotalCents !== null && !c.bulk)
    .map((c) => c.estimatedTotalCents!)
    .sort((a, b) => a - b);
  if (same.length < 2) return null;
  const mid = same.length / 2;
  const median = same.length % 2 ? same[Math.floor(mid)]! : Math.round((same[mid - 1]! + same[mid]!) / 2);
  return Math.max(0, median - pick.estimatedTotalCents);
}

export function recordSearch(stats: UsageStats, advice: MenuAdvice | null): UsageStats {
  const next = { ...stats, searches: stats.searches + 1 };
  if (!advice?.bestForRequest && !advice?.nearest) return next;
  const saving = advice ? adviceSavingCents(advice) : null;
  return {
    ...next,
    recommendations: next.recommendations + 1,
    savingsCents: next.savingsCents + (saving ?? 0),
    bestSavingCents: Math.max(next.bestSavingCents, saving ?? 0)
  };
}

export function usageText(stats: UsageStats): string {
  const brl = (c: number) => `R$${(c / 100).toFixed(2).replace(".", ",")}`;
  return [
    `UPAY3FOOD · meus números desde ${new Date(stats.since).toLocaleDateString("pt-BR")}`,
    `${stats.shops.length} lojas lidas · ${stats.itemsRead} itens comparados`,
    `${stats.searches} pesquisas · ${stats.recommendations} recomendações`,
    `Economia estimada: ${brl(stats.savingsCents)} no total · maior numa compra: ${brl(stats.bestSavingCents)}`,
    "(estimativa vs a mediana das opções do mesmo tamanho; sem dados pessoais)"
  ].join("\n");
}
