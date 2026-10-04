import { formatBRL } from "@nape3/domain";
import type { MarketView, PageSnapshot } from "../shared/types";

/**
 * On-page badge rendered inside a *closed* Shadow DOM attached to our own
 * host element. It never touches iFood's nodes or styles, and page CSS cannot
 * leak in. Removing the host removes every trace.
 */

const HOST_TAG = "upay3food-agent-badge";

let shadow: ShadowRoot | null = null;
let host: HTMLElement | null = null;

function ensureRoot(doc: Document): ShadowRoot {
  if (shadow && host?.isConnected) return shadow;
  host = doc.createElement(HOST_TAG);
  host.setAttribute("data-upay3food", "");
  shadow = host.attachShadow({ mode: "closed" });
  // Appended to <html>, outside iFood's <body> tree.
  doc.documentElement.appendChild(host);
  return shadow;
}

const STYLE = `
  :host { all: initial; }
  .badge { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; max-width: 300px;
    font: 12px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #111; color: #f6f5f2; padding: 10px 12px; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
  .eyebrow { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; opacity: .6; }
  .row { display: flex; justify-content: space-between; gap: 12px; margin-top: 4px; }
  .muted { opacity: .7; }
  button { all: unset; cursor: pointer; float: right; opacity: .6; padding: 0 2px; }
`;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function renderBadge(doc: Document, snapshot: PageSnapshot, market: MarketView | null): void {
  const total = snapshot.cart?.totalCents.value ?? snapshot.pix?.amountCents.value ?? null;
  if (total === null) {
    removeBadge();
    return;
  }
  const root = ensureRoot(doc);
  const summary = market?.summary;
  const marketLine =
    summary && summary.sufficient && summary.medianCents !== null && summary.lowestCents !== null
      ? `<div class="row"><span>Median</span><strong>${formatBRL(summary.medianCents)}</strong></div>
         <div class="row"><span>Lowest observed</span><strong>${formatBRL(summary.lowestCents)}</strong></div>
         <div class="muted">${summary.sampleSize} fresh observations${summary.containsSynthetic ? " · includes synthetic fixtures" : ""}</div>`
      : `<div class="muted">Not enough fresh market data</div>`;
  root.innerHTML = `<style>${STYLE}</style>
    <div class="badge" role="status">
      <button title="Hide" aria-label="Hide">✕</button>
      <div class="eyebrow">UPAY3FOOD.agent · ${escapeHtml(snapshot.detection.context)}</div>
      <div class="row"><span>Current checkout</span><strong>${formatBRL(total)}</strong></div>
      ${marketLine}
    </div>`;
  root.querySelector("button")?.addEventListener("click", removeBadge, { once: true });
}

export function removeBadge(): void {
  host?.remove();
  host = null;
  shadow = null;
}
