import { addCents, cents, computeCartTotal, formatBRL, parseAllBRL, subtractCents, type Cents } from "@nape3/domain";
import type { CartSnapshot, ExtractedLine, Field } from "../../shared/types";
import { CTA, LABELS } from "../context";
import {
  amountForLabel,
  clean,
  field,
  findByOwnText,
  isOnScreen,
  isStruckThrough,
  isVisible,
  missing,
  ownText,
  parseEta,
  textOf
} from "../dom";

const ALL_LABELS = Object.values(LABELS);
const others = (label: RegExp) => ALL_LABELS.filter((l) => l !== label);

type Stage = "cart" | "checkout";

// ---------------------------------------------------------------------------
// Order-summary container selection
// ---------------------------------------------------------------------------

/**
 * Every element that is the nearest ancestor of a "Subtotal" label also
 * holding a "Total" label. A SPA can keep several mounted at once (e.g. the
 * bag drawer with the *previous* cart state next to the checkout).
 */
export function findSummaryCandidates(root: Element): Element[] {
  const totals = findByOwnText(root, LABELS.total);
  const found = new Set<Element>();
  for (const subtotal of findByOwnText(root, LABELS.subtotal)) {
    for (let el = subtotal.parentElement; el; el = el.parentElement) {
      if (totals.some((t) => el.contains(t))) {
        found.add(el);
        break;
      }
    }
  }
  const list = [...found];
  return list.filter((c) => !list.some((o) => o !== c && c.contains(o)));
}

/** Nearest ancestor (≤ 4 levels) that also holds the item list. */
function regionOf(summary: Element): Element {
  let region: Element = summary;
  for (let el = summary.parentElement, depth = 0; el && depth < 4; el = el.parentElement, depth++) {
    region = el;
    if (el.querySelector("li, [data-testid*='item' i]")) break;
  }
  return region;
}

/**
 * Which flow does this summary belong to? Climb from the summary and stop at
 * the first ancestor that contains any call-to-action: the nearest CTA wins.
 * +1 = this flow's CTA, −1 = the other flow's (e.g. a bag drawer at checkout).
 */
function affinity(summary: Element, stage: Stage): { score: number; evidence: string } {
  const otherStage: Stage = stage === "checkout" ? "cart" : "checkout";
  for (let el: Element | null = summary, depth = 0; el && depth < 8; el = el.parentElement, depth++) {
    const own = findByOwnText(el, CTA[stage]).some(isOnScreen);
    const other = findByOwnText(el, CTA[otherStage]).some(isOnScreen);
    if (own && !other) return { score: 1, evidence: `${stage} CTA nearest` };
    if (other && !own) return { score: -1, evidence: `${otherStage} CTA nearest` };
    if (own && other) return { score: 0, evidence: "both CTAs at the same distance" };
  }
  return { score: 0, evidence: "no CTA nearby" };
}

function describe(el: Element): string {
  const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)[0];
  const testId = el.getAttribute("data-testid");
  return `<${el.tagName.toLowerCase()}${testId ? ` data-testid=${testId}` : cls ? `.${cls}` : ""}>`;
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

const QTY_PATTERNS = [/(?:^|\s)(\d{1,2})\s*[x×]\s/i, /\s[x×]\s?(\d{1,2})(?=\s|$)/i, /(?:^|\s)(\d{1,2})\s*(?:un|und|unid)\.?\s/i];

export function parseLineQuantity(text: string): number | null {
  const padded = ` ${text} `;
  for (const pattern of QTY_PATTERNS) {
    const match = pattern.exec(padded);
    if (match) return Number.parseInt(match[1]!, 10);
  }
  return null;
}

/**
 * Item lines: inside the cart region, outside the summary. A line is the
 * innermost item block with exactly one live (non-struck) price.
 */
function extractLines(region: Element, summary: Element): ExtractedLine[] {
  const lines: ExtractedLine[] = [];
  const candidates = Array.from(region.querySelectorAll("li, [data-testid*='item' i], [class*='item' i]")).filter(
    (el) => isVisible(el) && !summary.contains(el) && !el.contains(summary)
  );
  for (const el of candidates) {
    if (candidates.some((other) => other !== el && el.contains(other))) continue;
    const struck = Array.from(el.querySelectorAll("*")).filter((c) => isStruckThrough(c) && parseAllBRL(textOf(c)).length);
    const live = parseAllBRL(textOf(el)).filter((a) => !struck.some((s) => parseAllBRL(textOf(s)).includes(a)));
    if (live.length !== 1) continue;
    const text = textOf(el);
    const quantity = parseLineQuantity(text);
    const title = clean(
      text
        .replace(/R\$\s*-?\s*[\d.]+(,\d{1,2})?/g, " ")
        .replace(/(?:^|\s)\d{1,2}\s*[x×]\s/i, " ")
        .replace(/\s[x×]\s?\d{1,2}(?=\s|$)/i, " ")
        .replace(/\b(editar|remover|excluir|item promocional|promo[cç][aã]o)\b/gi, " ")
        // Quantity stepper "− 1 +" rendered inside the line.
        .replace(/(?:^|\s)[−-]\s*\d{1,2}\s*\+(?=\s|$)/g, " ")
    );
    if (!title) continue;
    lines.push({
      sourceTitle: title.slice(0, 120),
      quantity: quantity ?? 1,
      lineTotalCents: live[0]!,
      evidence: `"${text.slice(0, 80)}"${quantity === null ? " (no quantity marker; assumed 1)" : ""}`
    });
  }
  return lines;
}

/**
 * Lines must add up to the subtotal. Some layouts show the *unit* price next
 * to "2x"; if qty × price adds up instead, the lines are corrected and say so.
 */
function reconcileLines(lines: ExtractedLine[], subtotal: Cents | null): { lines: ExtractedLine[]; issue: string | null } {
  if (lines.length === 0) return { lines, issue: "item lines could not be read" };
  if (subtotal === null) return { lines, issue: "subtotal missing" };
  const asTotals = addCents(...lines.map((l) => l.lineTotalCents));
  if (asTotals === subtotal) return { lines, issue: null };
  const asUnits = lines.reduce((sum, l) => sum + l.lineTotalCents * l.quantity, 0);
  if (asUnits === subtotal) {
    return {
      lines: lines.map((l) => ({
        ...l,
        lineTotalCents: cents(l.lineTotalCents * l.quantity),
        evidence: `${l.evidence} (unit price × ${l.quantity})`
      })),
      issue: null
    };
  }
  return { lines: [], issue: `item lines (${formatBRL(asTotals)}) do not add up to subtotal ${formatBRL(subtotal)}` };
}

function merchantFromRegion(region: Element): Field<string> {
  const label = findByOwnText(region, /^seu pedido em\b|^pedido em\b/i)[0];
  if (label) {
    const inline = /pedido em\s+(.+)$/i.exec(textOf(label));
    if (inline?.[1]) return field(clean(inline[1]), "high", `"${textOf(label)}"`);
    const next = label.nextElementSibling;
    if (next && textOf(next)) return field(textOf(next), "medium", `sibling of "${ownText(label)}"`);
  }
  return missing("merchant label ('Seu pedido em') not found");
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function emptySnapshot(stage: Stage, reason: string, selection: CartSnapshot["summarySelection"]): CartSnapshot {
  const none = missing<Cents>(reason);
  return {
    stage,
    merchantName: missing(reason),
    lines: [],
    itemsSubtotalCents: none,
    deliveryFeeCents: none,
    serviceFeeCents: none,
    discountCents: none,
    totalCents: none,
    eta: missing(reason),
    paymentMethod: missing(reason),
    reconciliation: null,
    validity: { valid: false, reasons: [reason] },
    summarySelection: selection
  };
}

export function extractCart(doc: Document, stage: Stage = "cart"): CartSnapshot {
  const root = doc.body;
  const candidates = findSummaryCandidates(root).map((el) => {
    const totalField = amountForLabel(el, LABELS.total, others(LABELS.total));
    return { el, onScreen: isOnScreen(el), affinity: affinity(el, stage), total: totalField.value };
  });
  const rejected: string[] = [];
  const label = (c: (typeof candidates)[number]) => `${describe(c.el)} total ${c.total === null ? "?" : formatBRL(c.total)}`;

  const onScreen = candidates.filter((c) => {
    if (!c.onScreen) rejected.push(`${label(c)}: not on screen (off-canvas/hidden)`);
    return c.onScreen;
  });
  const best = Math.max(...onScreen.map((c) => c.affinity.score));
  const top = onScreen.filter((c) => {
    if (c.affinity.score < best) rejected.push(`${label(c)}: ${c.affinity.evidence}`);
    return c.affinity.score === best;
  });

  const selection = { candidates: candidates.length, chosen: null as string | null, rejected };
  if (candidates.length === 0) return emptySnapshot(stage, "order summary (Subtotal + Total) not found", selection);
  if (top.length === 0) return emptySnapshot(stage, "no order summary is currently on screen", selection);
  if (new Set(top.map((c) => c.total)).size > 1) {
    return emptySnapshot(
      stage,
      `ambiguous: ${top.length} order summaries on screen with different totals (${top.map(label).join(", ")})`,
      selection
    );
  }
  const chosen = top[0]!;
  selection.chosen = `${label(chosen)} · ${chosen.affinity.evidence}`;

  const summary = chosen.el;
  const region = regionOf(summary);
  const itemsSubtotalCents = amountForLabel(summary, LABELS.subtotal, others(LABELS.subtotal));
  const totalCents = amountForLabel(summary, LABELS.total, others(LABELS.total));
  let deliveryFeeCents = amountForLabel(summary, LABELS.deliveryFee, others(LABELS.deliveryFee), { allowFree: true });
  let serviceFeeCents = amountForLabel(summary, LABELS.serviceFee, others(LABELS.serviceFee), { allowFree: true });
  let discountCents = amountForLabel(summary, LABELS.discount, others(LABELS.discount));

  // An absent row means "not charged" — accepted only because the total must reconcile below.
  const absentAsZero = (f: Field<Cents>, name: string): Field<Cents> =>
    f.value === null ? field(cents(0), "low", `${name} row absent; assumed R$0,00 (checked by reconciliation)`) : f;
  deliveryFeeCents = absentAsZero(deliveryFeeCents, "delivery fee");
  serviceFeeCents = absentAsZero(serviceFeeCents, "service fee");
  discountCents = absentAsZero(discountCents, "discount");

  const reasons: string[] = [];
  let reconciliation: CartSnapshot["reconciliation"] = null;
  if (itemsSubtotalCents.value === null) reasons.push("subtotal not found");
  if (totalCents.value === null) reasons.push("total not found");
  if (itemsSubtotalCents.value !== null && totalCents.value !== null) {
    const expected = computeCartTotal({
      itemsSubtotalCents: itemsSubtotalCents.value,
      deliveryFeeCents: deliveryFeeCents.value!,
      serviceFeeCents: serviceFeeCents.value!,
      discountCents: discountCents.value!
    });
    const difference = subtractCents(totalCents.value, expected);
    reconciliation = { consistent: difference === 0, differenceCents: difference };
    if (difference !== 0) {
      reasons.push(
        `reconciliation failed: subtotal ${formatBRL(itemsSubtotalCents.value)} + delivery ${formatBRL(deliveryFeeCents.value!)} + service ${formatBRL(serviceFeeCents.value!)} − discount ${formatBRL(discountCents.value!)} = ${formatBRL(expected)} ≠ total ${formatBRL(totalCents.value)}`
      );
    }
  }

  const { lines, issue } = reconcileLines(extractLines(region, summary), itemsSubtotalCents.value);
  if (issue) reasons.push(issue);

  // The checkout page is about this order; a cart drawer is not.
  const etaScope = stage === "checkout" ? root : region;
  const etaEl = findByOwnText(etaScope, /\d{1,3}\s*[-–]\s*\d{1,3}\s*min/i).find(isOnScreen);
  const eta = etaEl ? parseEta(textOf(etaEl)) : null;
  const paymentLabel = findByOwnText(root, /^(forma de )?pagamento$/i).find(isOnScreen);
  const paymentText = paymentLabel?.parentElement ? textOf(paymentLabel.parentElement) : "";
  const paymentMethod = /\bpix\b/i.test(paymentText)
    ? field("pix", "medium", `"${paymentText.slice(0, 60)}"`)
    : /cart[aã]o|cr[eé]dito|d[eé]bito/i.test(paymentText)
      ? field("card", "medium", `"${paymentText.slice(0, 60)}"`)
      : missing<string>("payment method not identified");

  return {
    stage,
    merchantName: merchantFromRegion(region),
    lines,
    itemsSubtotalCents,
    deliveryFeeCents,
    serviceFeeCents,
    discountCents,
    totalCents,
    eta: eta ? field(eta, "medium", `"${textOf(etaEl!)}"`) : missing("ETA not found"),
    paymentMethod,
    reconciliation,
    validity: { valid: reasons.length === 0, reasons },
    summarySelection: selection
  };
}

export function extractCheckout(doc: Document): CartSnapshot {
  return extractCart(doc, "checkout");
}
