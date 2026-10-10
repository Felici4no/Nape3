import { formatBRL, liquidValue, menuValue, readBurger, type Cents } from "@nape3/domain";
import type { MenuCard } from "../shared/types";
import { clean, isVisible, textOf } from "./dom";

/**
 * Highlights the best items on a restaurant page. Nothing is clicked and no
 * iFood node is changed: one host element of ours (closed Shadow DOM, mounted
 * after the page settled, like the badge) draws outlines and labels at the
 * cards' positions, and follows scrolling.
 */

export interface Highlight {
  title: string;
  priceCents: number;
  label: string;
  tone: "best" | "agent" | "bulk";
}

export interface RecommendedItem {
  merchantKey: string;
  title: string;
  priceCents: number;
  estimatedTotalCents: number | null;
  at: string;
}

/** Which cards to mark: the agent's pick for this shop, and the best value per kind. */
export function pickHighlights(menu: readonly MenuCard[], recommended?: RecommendedItem | null): Highlight[] {
  const out: Highlight[] = [];
  const add = (h: Highlight) => {
    if (!out.some((o) => o.title === h.title && o.priceCents === h.priceCents)) out.push(h);
  };
  if (recommended) {
    add({
      title: recommended.title,
      priceCents: recommended.priceCents,
      tone: "agent",
      label: `Recomendado${recommended.estimatedTotalCents !== null ? ` · ${formatBRL(recommended.estimatedTotalCents as Cents)} estimado` : ""}`
    });
  }
  const acai = menu.filter((m) => /a[cç]a[ií]/i.test(m.title));
  const acaiValue = menuValue(acai, "volume");
  if (acaiValue.best && acaiValue.ranked.length >= 2) {
    add({ title: acaiValue.best.title, priceCents: acaiValue.best.priceCents, tone: "best", label: `★ Melhor por litro · ${formatBRL((acaiValue.best.pricePer100mlCents * 10) as Cents)}/L` });
  }
  if (acaiValue.bulkBest) {
    add({ title: acaiValue.bulkBest.title, priceCents: acaiValue.bulkBest.priceCents, tone: "bulk", label: `Pote · ${formatBRL((acaiValue.bulkBest.pricePer100mlCents * 10) as Cents)}/L` });
  }
  const burgers = menu.filter((m) => readBurger(m.title).meatGrams !== null);
  const meat = menuValue(burgers, "meat");
  if (meat.best && meat.ranked.length >= 2) {
    add({ title: meat.best.title, priceCents: meat.best.priceCents, tone: "best", label: `★ Melhor por 100 g de carne · ${formatBRL(meat.best.pricePer100mlCents as Cents)}` });
  }
  for (const group of liquidValue(menu)) {
    if (group.kind === "acai" || group.ranked.length < 2) continue;
    const best = group.ranked[0]!;
    add({ title: best.title, priceCents: best.priceCents, tone: "best", label: `★ ${group.label}: melhor por litro · ${formatBRL(best.pricePerLiterCents as Cents)}/L` });
  }
  return out;
}

const norm = (t: string) => clean(t).toLowerCase();

/** Visible cards on the page for one item (title + price); the carousel may repeat a card. */
export function findCards(doc: Document, title: string, priceCents: number): Element[] {
  const want = norm(title);
  return Array.from(doc.querySelectorAll('[class~="dish-card"], a[class*="dish-card"]')).filter((card) => {
    const t = card.querySelector('[class*="dish-card__description"]') ?? card.querySelector("h3");
    if (!t || norm(textOf(t)) !== want || !isVisible(card)) return false;
    const price = card.querySelector('[class*="price--discount"]') ?? card.querySelector('[class*="dish-card__price"]');
    return !!price && textOf(price).replace(/\D/g, "").endsWith(String(priceCents));
  });
}

const HOST_TAG = "upay3food-highlights";
let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let current: Array<{ el: Element; h: Highlight }> = [];
let frame = 0;

const STYLE = `
  :host { all: initial; }
  .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
  .box { position: fixed; border-radius: 14px; box-sizing: border-box; transition: opacity .2s; }
  .box.best { outline: 3px solid #2f7d32; outline-offset: 2px; }
  .box.agent { outline: 3px solid #d7322b; outline-offset: 2px; }
  .box.bulk { outline: 2px dashed #8a7f70; outline-offset: 2px; }
  .box.pulse { animation: pulse 1.2s ease-out 2; }
  @keyframes pulse { 0% { outline-offset: 2px; } 50% { outline-offset: 8px; } 100% { outline-offset: 2px; } }
  .tag { position: absolute; left: 10px; top: -13px; padding: 3px 9px; border-radius: 999px; white-space: nowrap;
    font: 700 11px/1.3 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; }
  .best .tag { background: #2f7d32; } .agent .tag { background: #d7322b; } .bulk .tag { background: #4a4237; }
`;

function root(doc: Document): ShadowRoot {
  if (shadow && host?.isConnected) return shadow;
  host = doc.createElement(HOST_TAG);
  host.setAttribute("data-upay3food", "");
  shadow = host.attachShadow({ mode: "closed" });
  doc.body.appendChild(host);
  return shadow;
}

function place() {
  frame = 0;
  if (!shadow) return;
  const boxes = shadow.querySelectorAll<HTMLElement>(".box");
  current.forEach(({ el }, i) => {
    const box = boxes[i];
    if (!box) return;
    const r = el.getBoundingClientRect();
    const visible = el.isConnected && r.width > 0 && r.height > 0;
    box.style.opacity = visible ? "1" : "0";
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
  });
}

const raf = (cb: () => void) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number));
const schedule = () => {
  if (!frame) frame = raf(place);
};

/** Draws (or clears) the highlights. Call again after page changes; it is idempotent. */
export function renderHighlights(doc: Document, highlights: readonly Highlight[]) {
  const next = highlights.flatMap((h) => findCards(doc, h.title, h.priceCents).slice(0, 2).map((el) => ({ el, h })));
  if (next.length === 0) {
    clearHighlights();
    return;
  }
  const same = next.length === current.length && next.every((n, i) => n.el === current[i]?.el && n.h.label === current[i]?.h.label);
  current = next;
  if (!same) {
    const sr = root(doc);
    sr.innerHTML = `<style>${STYLE}</style><div class="layer"></div>`;
    const layer = sr.querySelector(".layer")!;
    for (const { h } of current) {
      const box = doc.createElement("div");
      box.className = `box ${h.tone}`;
      const tag = doc.createElement("span");
      tag.className = "tag";
      tag.textContent = h.label;
      box.appendChild(tag);
      layer.appendChild(box);
    }
    const win = doc.defaultView!;
    win.removeEventListener("scroll", schedule, true);
    win.removeEventListener("resize", schedule);
    win.addEventListener("scroll", schedule, { passive: true, capture: true });
    win.addEventListener("resize", schedule, { passive: true });
  }
  schedule();
}

export function clearHighlights() {
  current = [];
  host?.remove();
  host = null;
  shadow = null;
}

/** "Ver no cardápio": brings the item into view and pulses its outline. False when not on this page. */
export function revealItem(doc: Document, title: string, priceCents: number): boolean {
  const card = findCards(doc, title, priceCents)[0];
  if (!card) return false;
  if (typeof card.scrollIntoView === "function") card.scrollIntoView({ behavior: "smooth", block: "center" });
  const index = current.findIndex((c) => c.el === card);
  const box = shadow?.querySelectorAll<HTMLElement>(".box")[index];
  if (box) {
    box.classList.remove("pulse");
    void box.offsetWidth;
    box.classList.add("pulse");
  }
  return true;
}
