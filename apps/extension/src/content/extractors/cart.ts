import { addCents, cents, computeCartTotal, parseAllBRL, subtractCents, type Cents } from "@nape3/domain";
import type { CartSnapshot, ExtractedLine, Field } from "../../shared/types";
import { LABELS } from "../context";
import {
  amountForLabel,
  clean,
  field,
  findByOwnText,
  isStruckThrough,
  isVisible,
  missing,
  ownText,
  parseEta,
  smallestContainerWith,
  textOf
} from "../dom";

const ALL_LABELS = Object.values(LABELS);
const others = (label: RegExp) => ALL_LABELS.filter((l) => l !== label);

/**
 * The order summary is the smallest container holding both "Subtotal" and
 * "Total". All fees are read *inside* it, bound to their labels.
 */
export function findSummaryContainer(root: Element): Element | null {
  return smallestContainerWith(root, [LABELS.subtotal, LABELS.total]);
}

/**
 * Item lines: inside the cart region but outside the summary rows. A line is a
 * minimal block with one item title and exactly one price.
 */
function extractLines(region: Element, summary: Element): ExtractedLine[] {
  const lines: ExtractedLine[] = [];
  const candidates = Array.from(region.querySelectorAll("li, [data-testid*='item' i], [class*='item' i]")).filter(
    (el) => isVisible(el) && !summary.contains(el) && !el.contains(summary)
  );
  for (const el of candidates) {
    // Skip containers of other candidates (keep the innermost blocks).
    if (candidates.some((other) => other !== el && el.contains(other))) continue;
    const amounts = parseAllBRL(textOf(el));
    const struck = Array.from(el.querySelectorAll("*")).filter((c) => isStruckThrough(c) && parseAllBRL(textOf(c)).length);
    const live = amounts.filter((a) => !struck.some((s) => parseAllBRL(textOf(s)).includes(a)));
    if (live.length !== 1) continue;
    const text = textOf(el);
    const qty = /(?:^|\s)(\d{1,2})\s*x\s/i.exec(` ${text} `);
    const quantity = qty ? Number.parseInt(qty[1]!, 10) : 1;
    const title = clean(
      text
        .replace(/R\$\s*-?\s*[\d.]+(,\d{1,2})?/g, " ")
        .replace(/(?:^|\s)\d{1,2}\s*x\s/i, " ")
        .replace(/\b(editar|remover|excluir)\b/gi, " ")
    );
    if (!title) continue;
    lines.push({ sourceTitle: title.slice(0, 120), quantity, lineTotalCents: live[0]!, evidence: `"${text.slice(0, 80)}"` });
  }
  return lines;
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

export function extractCart(doc: Document, stage: "cart" | "checkout" = "cart"): CartSnapshot {
  const root = doc.body;
  const summary = findSummaryContainer(root);
  if (!summary) {
    const none = missing<Cents>("order summary (Subtotal + Total) not found");
    return {
      stage,
      merchantName: missing("order summary not found"),
      lines: [],
      itemsSubtotalCents: none,
      deliveryFeeCents: none,
      serviceFeeCents: none,
      discountCents: none,
      totalCents: none,
      eta: missing("order summary not found"),
      paymentMethod: missing("order summary not found"),
      reconciliation: null
    };
  }

  // The cart region is the nearest ancestor of the summary that also holds the
  // items (a <ul>/<li> list or item blocks); bounded to 4 levels.
  let region: Element = summary;
  for (let el: Element | null = summary.parentElement, depth = 0; el && depth < 4; el = el.parentElement, depth++) {
    region = el;
    if (el.querySelector("li, [data-testid*='item' i]")) break;
  }

  const itemsSubtotalCents = amountForLabel(summary, LABELS.subtotal, others(LABELS.subtotal));
  const totalCents = amountForLabel(summary, LABELS.total, others(LABELS.total));
  let deliveryFeeCents = amountForLabel(summary, LABELS.deliveryFee, others(LABELS.deliveryFee), { allowFree: true });
  let serviceFeeCents = amountForLabel(summary, LABELS.serviceFee, others(LABELS.serviceFee), { allowFree: true });
  let discountCents = amountForLabel(summary, LABELS.discount, others(LABELS.discount));

  // Absent rows mean "not charged" only when the displayed total reconciles.
  const absentAsZero = (f: Field<Cents>, name: string): Field<Cents> =>
    f.value === null ? field(cents(0), "low", `${name} row absent; assumed R$0,00`) : f;
  deliveryFeeCents = absentAsZero(deliveryFeeCents, "delivery fee");
  serviceFeeCents = absentAsZero(serviceFeeCents, "service fee");
  discountCents = absentAsZero(discountCents, "discount");

  let reconciliation: CartSnapshot["reconciliation"] = null;
  if (itemsSubtotalCents.value !== null && totalCents.value !== null) {
    const expected = computeCartTotal({
      itemsSubtotalCents: itemsSubtotalCents.value,
      deliveryFeeCents: deliveryFeeCents.value!,
      serviceFeeCents: serviceFeeCents.value!,
      discountCents: discountCents.value!
    });
    const difference = subtractCents(totalCents.value, expected);
    reconciliation = { consistent: difference === 0, differenceCents: difference };
  }

  // The checkout page is entirely about this order; the cart drawer is not.
  const etaScope = stage === "checkout" ? root : region;
  const etaEl = findByOwnText(etaScope, /\d{1,3}\s*[-–]\s*\d{1,3}\s*min/i)[0];
  const eta = etaEl ? parseEta(textOf(etaEl)) : null;
  const paymentLabel = findByOwnText(root, /^(forma de )?pagamento$/i)[0];
  const paymentText = paymentLabel?.parentElement ? textOf(paymentLabel.parentElement) : "";
  const paymentMethod = /\bpix\b/i.test(paymentText)
    ? field("pix", "medium", `"${paymentText.slice(0, 60)}"`)
    : /cart[aã]o|cr[eé]dito|d[eé]bito/i.test(paymentText)
      ? field("card", "medium", `"${paymentText.slice(0, 60)}"`)
      : missing<string>("payment method not identified");

  const lines = extractLines(region, summary);
  const linesSum = lines.length ? addCents(...lines.map((l) => l.lineTotalCents)) : null;

  return {
    stage,
    merchantName: merchantFromRegion(region),
    // Lines are only trusted when they add up to the displayed subtotal.
    lines: linesSum !== null && linesSum === itemsSubtotalCents.value ? lines : [],
    itemsSubtotalCents,
    deliveryFeeCents,
    serviceFeeCents,
    discountCents,
    totalCents,
    eta: eta ? field(eta, "medium", `"${textOf(etaEl!)}"`) : missing("ETA not found in cart"),
    paymentMethod,
    reconciliation
  };
}

export function extractCheckout(doc: Document): CartSnapshot {
  return extractCart(doc, "checkout");
}
