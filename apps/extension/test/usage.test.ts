import { describe, expect, it } from "vitest";
import { adviseFromMenus, parseIntent } from "@nape3/agent";
import { adviceSavingCents, emptyUsage, recordSearch, recordShop, usageText } from "../src/shared/usage";

const NOW = new Date("2026-10-10T12:00:00Z");
const intent = (t: string) => { const r = parseIntent(t); if (!r.ok) throw new Error(); return r.intent; };
const menus = [
  { merchant: { name: "A" }, source: "ifood" as const, observedAt: "2026-10-10T11:00:00Z", deliveryFeeCents: 0, items: [{ title: "Açaí 500ml", priceCents: 2000 }] },
  { merchant: { name: "B" }, source: "ifood" as const, observedAt: "2026-10-10T11:00:00Z", deliveryFeeCents: 500, items: [{ title: "Açaí 500ml", priceCents: 2200 }] },
  { merchant: { name: "C" }, source: "ifood" as const, observedAt: "2026-10-10T11:00:00Z", deliveryFeeCents: 699, items: [{ title: "Açaí 500ml", priceCents: 2400 }] }
];

describe("usage numbers", () => {
  it("estimates the saving vs the median same-size option", () => {
    const advice = adviseFromMenus(intent("quero açaí 500ml até R$40"), menus, { now: NOW });
    // totals 20,99 / 27,99 / 31,98 → median 27,99; pick 20,99 → R$7,00
    expect(adviceSavingCents(advice)).toBe(700);
    let s = recordShop(recordShop(emptyUsage(NOW), "A", 1), "A", 1);
    expect(s.shops).toHaveLength(1);
    s = recordSearch(s, advice);
    expect(s).toMatchObject({ searches: 1, recommendations: 1, savingsCents: 700, bestSavingCents: 700 });
    expect(usageText(s)).toContain("R$7,00");
  });
});
