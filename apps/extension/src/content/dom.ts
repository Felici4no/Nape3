import { cents, parseAllBRL, type Cents } from "@nape3/domain";
import type { Field } from "../shared/types";

/**
 * Read-only DOM helpers. Nothing here writes to, moves or removes page nodes.
 */

/** jsdom has no layout engine; real browsers do. */
const HAS_LAYOUT = typeof navigator === "undefined" || !/jsdom/i.test(navigator.userAgent);

export function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

/** Text of all descendant text nodes, joined with spaces so sibling cells never merge ("R$ 7,99" + "Grátis"). */
export function textOf(element: Element): string {
  const parts: string[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, 4 /* SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.textContent ?? "");
  return clean(parts.join(" "));
}

/** Text from the element's direct text nodes only (labels like <span>Subtotal</span>). */
export function ownText(element: Element): string {
  let text = "";
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3) text += node.textContent ?? "";
  }
  return clean(text);
}

export function isVisible(element: Element): boolean {
  for (let el: Element | null = element; el; el = el.parentElement) {
    if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return false;
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  }
  if (HAS_LAYOUT && element.getClientRects().length === 0) return false;
  return true;
}

/**
 * Whether the element is on screen *now*. Off-canvas drawers (translated out
 * of the viewport, opacity 0) keep layout boxes and stale content, so
 * isVisible() is not enough to pick "the current" container. Without a
 * layout engine (tests) this returns true and other signals decide.
 */
export function isOnScreen(element: Element): boolean {
  if (!isVisible(element)) return false;
  for (let el: Element | null = element; el; el = el.parentElement) {
    if (el.hasAttribute("inert")) return false;
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (style && style.opacity === "0") return false;
  }
  if (!HAS_LAYOUT) return true;
  const view = element.ownerDocument.defaultView;
  const rect = element.getBoundingClientRect();
  if (!view || rect.width === 0 || rect.height === 0) return false;
  // Horizontally outside the viewport = off-canvas. (Below the fold is fine.)
  return rect.right > 0 && rect.left < view.innerWidth;
}

export function isStruckThrough(element: Element): boolean {
  for (let el: Element | null = element; el; el = el.parentElement) {
    if (el.tagName === "S" || el.tagName === "DEL" || el.tagName === "STRIKE") return true;
    const style = el.ownerDocument.defaultView?.getComputedStyle(el);
    if (style?.textDecorationLine?.includes("line-through") || style?.textDecoration?.includes("line-through")) return true;
  }
  return false;
}

/** All visible elements under `root` whose own text matches `pattern`. */
export function findByOwnText(root: ParentNode, pattern: RegExp): Element[] {
  return Array.from(root.querySelectorAll("*")).filter(
    (el) => pattern.test(ownText(el)) && isVisible(el)
  );
}

export function pageText(root: ParentNode & Node): string {
  return clean(root.textContent);
}

/** Visible, non-struck BRL amounts inside `container`, in document order. */
export function amountsIn(container: Element): Array<{ cents: Cents; struck: boolean; text: string }> {
  const hasAmount = (el: Element) => parseAllBRL(textOf(el)).length > 0;
  // Minimal elements: contain an amount, but no child element does. This keeps
  // "R$ <span>19,90</span>" together and separates sibling price rows.
  const minimal = [container, ...Array.from(container.querySelectorAll("*"))].filter(
    (el) => hasAmount(el) && !Array.from(el.children).some(hasAmount) && isVisible(el)
  );
  return minimal.flatMap((el) =>
    parseAllBRL(textOf(el)).map((value) => ({ cents: value, struck: isStruckThrough(el), text: textOf(el) }))
  );
}

export function field<T>(value: T | null, confidence: Field<T>["confidence"], evidence: string): Field<T> {
  return { value, confidence, evidence };
}

export function missing<T>(evidence: string): Field<T> {
  return { value: null, confidence: "missing", evidence };
}

const FREE_RE = /\bgr[aá]tis\b/i;

/**
 * Finds the amount bound to a label (e.g. "Taxa de entrega") by climbing from
 * the label to the smallest ancestor row that contains an amount and no other
 * known label. Returns null when the binding is ambiguous.
 */
export function amountForLabel(
  root: Element,
  label: RegExp,
  otherLabels: RegExp[],
  options: { allowFree?: boolean } = {}
): Field<Cents> {
  const labels = findByOwnText(root, label);
  if (labels.length === 0) return missing(`label ${label} not found`);

  for (const labelEl of labels) {
    let row: Element | null = labelEl;
    for (let depth = 0; row && depth < 4 && row !== root.parentElement; depth++, row = row.parentElement) {
      const rowText = textOf(row);
      const clashes = otherLabels.some((other) =>
        findByOwnText(row!, other).some((el) => el !== labelEl && !labelEl.contains(el))
      );
      if (clashes) break;
      const amounts = amountsIn(row).filter((a) => !a.struck);
      if (amounts.length > 0) {
        const chosen = amounts[amounts.length - 1]!;
        return field(
          chosen.cents < 0 ? cents(-chosen.cents) : chosen.cents,
          amounts.length === 1 ? "high" : "medium",
          `"${ownText(labelEl)}" → "${clean(rowText).slice(0, 80)}"`
        );
      }
      if (options.allowFree && FREE_RE.test(rowText)) {
        return field(cents(0), "high", `"${ownText(labelEl)}" → "Grátis"`);
      }
    }
  }
  return missing(`no amount bound to ${label}`);
}

export function parseEta(text: string): { min: number; max: number } | null {
  const range = /(\d{1,3})\s*[-–a]\s*(\d{1,3})\s*min/i.exec(text);
  if (range) {
    const min = Number.parseInt(range[1]!, 10);
    const max = Number.parseInt(range[2]!, 10);
    return max >= min ? { min, max } : null;
  }
  const single = /(\d{1,3})\s*min\b/i.exec(text);
  if (single) {
    const value = Number.parseInt(single[1]!, 10);
    return { min: value, max: value };
  }
  return null;
}
