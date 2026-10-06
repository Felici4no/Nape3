import { formatBRL } from "@nape3/domain";
import type { MarketView, PageSnapshot } from "../shared/types";

/**
 * Optional on-page badge rendered inside a *closed* Shadow DOM attached to our
 * own host element. It never touches iFood's nodes or styles.
 *
 * iFood web is a React/Next.js app that hydrates the whole document. Inserting
 * any node while hydration runs (or directly under <html>) can make React throw
 * ("Application error: a client-side exception has occurred"). So the badge is
 * OFF by default, and when enabled it is mounted at the end of <body> only
 * after the page has fully loaded and gone idle (see `whenPageSettled`).
 */

const HOST_TAG = "upay3food-agent-badge";

let shadow: ShadowRoot | null = null;
let host: HTMLElement | null = null;

function ensureRoot(doc: Document): ShadowRoot {
  if (shadow && host?.isConnected) return shadow;
  host = doc.createElement(HOST_TAG);
  host.setAttribute("data-upay3food", "");
  shadow = host.attachShadow({ mode: "closed" });
  // Last child of <body>, never under <html>, and only after whenPageSettled().
  doc.body.appendChild(host);
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
  .label { margin-top: 6px; opacity: .75; }
  .total { font-size: 22px; font-weight: 700; letter-spacing: -.01em; margin: 1px 0 6px; }
  .note { max-width: 220px; }
  button { all: unset; cursor: pointer; float: right; opacity: .6; padding: 0 2px; }
`;

/** Resolves after `load`, an idle period and a grace delay — i.e. after hydration. */
export function whenPageSettled(win: Window, graceMs = 2000): Promise<void> {
  const afterLoad =
    win.document.readyState === "complete"
      ? Promise.resolve()
      : new Promise<void>((resolve) => win.addEventListener("load", () => resolve(), { once: true }));
  return afterLoad
    .then(
      () =>
        new Promise<void>((resolve) => {
          if ("requestIdleCallback" in win) win.requestIdleCallback(() => resolve(), { timeout: 5000 });
          else setTimeout(resolve, 500);
        })
    )
    .then(() => new Promise<void>((resolve) => setTimeout(resolve, graceMs)));
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function renderBadge(doc: Document, snapshot: PageSnapshot, market: MarketView | null, debug = false): void {
  const cart = snapshot.cart;
  const pixAmount = snapshot.pix?.amountCents.value ?? null;
  if (!cart && pixAmount === null) {
    removeBadge();
    return;
  }
  const root = ensureRoot(doc);
  const time = new Date(snapshot.capturedAt).toLocaleTimeString("pt-BR");
  const debugLine = debug
    ? `<div class="muted">extracted ${escapeHtml(time)} · ${escapeHtml(snapshot.snapshotId)}${market?.observation ? ` · observed ${escapeHtml(new Date(market.observation.observedAt).toLocaleTimeString("pt-BR"))}` : ""}</div>`
    : "";

  // Product copy in pt-BR; the page context and timestamps stay in debug only.
  let body: string;
  if (cart && !cart.validity.valid) {
    // Never show an unvalidated total (and never an item price instead).
    body = `<div class="label">Seu checkout</div>
      <div class="total">não validado</div>
      <div class="muted">Não consegui conferir os valores desta página, então não mostro um total.</div>
      ${debug ? `<div class="muted">${escapeHtml(cart.validity.reasons[0] ?? "")}</div>` : ""}`;
  } else {
    const total = cart?.totalCents.value ?? pixAmount!;
    const summary = market?.summary;
    const marketLine = !market
      ? `<div class="muted">Comparando…</div>`
      : summary && summary.sufficient && summary.medianCents !== null && summary.lowestCents !== null
        ? `<div class="row"><span>Mediana</span><strong>${formatBRL(summary.medianCents)}</strong></div>
           <div class="row"><span>Menor observado</span><strong>${formatBRL(summary.lowestCents)}</strong></div>
           <div class="muted">${summary.sampleSize} observações recentes${summary.containsSynthetic ? " · inclui dados sintéticos" : ""}</div>`
        : `<div class="muted note">Ainda não há ofertas suficientes para comparar este pedido.</div>`;
    body = `<div class="label">Seu checkout</div><div class="total">${formatBRL(total)}</div>${marketLine}`;
  }

  root.innerHTML = `<style>${STYLE}</style>
    <div class="badge" role="status">
      <button title="Ocultar" aria-label="Ocultar">✕</button>
      <div class="eyebrow">UPAY3FOOD</div>
      ${body}
      ${debug ? `<div class="muted">${escapeHtml(snapshot.detection.context)}</div>${debugLine}` : ""}
    </div>`;
  root.querySelector("button")?.addEventListener("click", removeBadge, { once: true });
}

export function removeBadge(): void {
  host?.remove();
  host = null;
  shadow = null;
}
