import { looksLikePixPayload } from "@nape3/payments";
import type { ContextDetection, PageContext } from "../shared/types";
import { findByOwnText, isVisible } from "./dom";

/**
 * Page-context detection for iFood web.
 *
 * ASSUMPTIONS (to be calibrated on real pages): the URL hints and pt-BR
 * labels below are based on how iFood web is commonly structured, not on a
 * verified capture of every page. Detection therefore combines URL hints
 * with visible-label signals and reports which signals fired.
 */

interface Rule {
  context: PageContext;
  url?: RegExp;
  /** Each matching label adds to the score. */
  labels: RegExp[];
  /** Labels that must all be present for the context to be considered. */
  required?: RegExp[];
  extra?: (doc: Document) => string | null;
}

export const LABELS = {
  subtotal: /^subtotal:?$/i,
  deliveryFee: /^(taxa de entrega|entrega|frete):?$/i,
  serviceFee: /^taxa de servi[cç]o:?$/i,
  // "Cupom", "Cupom IFOOD10", "Desconto do cupom", "Descontos" — but never a row that itself holds the amount text.
  discount: /^(cupom|cupons|desconto|descontos)\b(?!.*R\$).{0,30}$/i,
  total: /^total( a pagar| do pedido)?:?$/i
} as const;

/** Call-to-action labels that tell which flow an order summary belongs to. */
export const CTA = {
  checkout: /^((fazer|finalizar|confirmar) pedido|pagar( agora)?|fazer pedido e pagar)$/i,
  cart: /^(escolher forma de pagamento|continuar|ir para (o )?pagamento|ver sacola)$/i
} as const;

function visiblePixPayload(doc: Document): string | null {
  for (const input of Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))) {
    if (isVisible(input) && looksLikePixPayload(input.value)) return "Pix payload in input";
  }
  const text = doc.body?.textContent ?? "";
  return /000201\S*br\.gov\.bcb\.pix/i.test(text) ? "Pix payload in text" : null;
}

const RULES: Rule[] = [
  {
    context: "PIX_PAYMENT",
    labels: [/pix copia e cola/i, /copiar c[oó]digo( pix)?/i, /pague com pix/i, /c[oó]digo pix/i, /escaneie o qr ?code/i],
    extra: visiblePixPayload
  },
  {
    context: "ORDER_CONFIRMATION",
    url: /\/pedidos?\/[^/]+\/(acompanhar|status)|\/meus-pedidos/i,
    labels: [/^pedido confirmado/i, /acompanhe seu pedido/i, /pedido realizado/i, /seu pedido foi (enviado|recebido)/i]
  },
  {
    context: "CHECKOUT",
    url: /\/(checkout|pedido\/finalizar|finalizar-pedido)/i,
    labels: [/^(fazer|finalizar|confirmar) pedido$/i, /^forma de pagamento$/i, /^pagamento$/i, /^pagar na entrega$/i, /^pague pelo app$/i],
    required: [LABELS.total]
  },
  {
    context: "CART",
    labels: [/^(sua )?sacola$/i, /^escolher forma de pagamento$/i, /^continuar$/i, /^limpar$/i],
    required: [LABELS.subtotal, LABELS.total]
  },
  {
    context: "PRODUCT",
    url: /[?&]item=|\/produto\//i,
    labels: [/^adicionar\b/i, /alguma observa[cç][aã]o\??/i, /^observa[cç][oõ]es$/i],
    extra: (doc) => (doc.querySelector('[role="dialog"], [aria-modal="true"]') ? "dialog open" : null)
  },
  {
    context: "RESTAURANT",
    url: /\/delivery\/[^/]+\/[^/]+\/[0-9a-f-]{8,}/i,
    labels: [/^card[aá]pio$/i, /pedido m[ií]nimo/i, /^ver mais$/i, /^destaques$/i]
  },
  {
    context: "SEARCH_RESULTS",
    url: /\/busca|[?&]q=/i,
    labels: [/^resultados? (para|de)\b/i, /^lojas$/i, /^itens$/i]
  }
];

/** Order matters: the most specific / most actionable context wins ties. */
const PRIORITY: PageContext[] = RULES.map((rule) => rule.context);

export function detectPageContext(doc: Document, url: string): ContextDetection {
  const root = doc.body;
  if (!root) return { context: "UNKNOWN", confidence: 0, signals: ["no document body"] };

  const results = RULES.map((rule) => {
    const signals: string[] = [];
    if (rule.required && rule.required.some((label) => findByOwnText(root, label).length === 0)) {
      return { rule, score: 0, signals };
    }
    let score = 0;
    if (rule.url?.test(url)) {
      score += 1;
      signals.push(`url ${rule.url}`);
    }
    for (const label of rule.labels) {
      if (findByOwnText(root, label).length > 0) {
        score += 1;
        signals.push(`label ${label}`);
      }
    }
    if (rule.required) {
      score += rule.required.length * 0.5;
      signals.push(...rule.required.map((label) => `required ${label}`));
    }
    const extra = rule.extra?.(doc);
    if (extra) {
      score += 2;
      signals.push(extra);
    }
    return { rule, score, signals };
  });

  const best = results
    .filter((r) => r.score >= 1.5)
    .sort((a, b) => b.score - a.score || PRIORITY.indexOf(a.rule.context) - PRIORITY.indexOf(b.rule.context))[0];

  // A strong, higher-priority context beats a slightly higher score elsewhere
  // (e.g. the cart drawer open on a restaurant page).
  const strongest = results.find((r) => r.score >= 2.5);
  const chosen = strongest && best && PRIORITY.indexOf(strongest.rule.context) < PRIORITY.indexOf(best.rule.context)
    ? strongest
    : best;

  if (!chosen) return { context: "UNKNOWN", confidence: 0, signals: ["no context reached the threshold"] };
  return {
    context: chosen.rule.context,
    confidence: Math.min(1, chosen.score / 4),
    signals: chosen.signals
  };
}
