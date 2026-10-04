import { findSummaryCandidates } from "./extractors/cart";
import { isOnScreen } from "./dom";

/**
 * Debug capture of the *order-summary* structure, so extractors can be
 * calibrated against real markup. Only summary candidates and their item
 * region are serialized; text is scrubbed of e-mails, phones, CEPs, long
 * digit runs and street addresses. The user reviews it before sharing.
 */

const KEEP_ATTRS = ["data-testid", "role", "aria-label", "aria-hidden", "hidden", "inert"];

export function scrub(text: string): string {
  return text
    .replace(/\S+@\S+\.\S+/g, "[email]")
    .replace(/\b\d{5}-?\d{3}\b/g, "[cep]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[phone]")
    .replace(/\b(rua|r\.|av\.?|avenida|alameda|travessa|estrada|rodovia|pra[cç]a|apto|apartamento|bloco)\b.{0,80}/gi, "[address]")
    .replace(/\b\d{6,}\b/g, "[number]");
}

function serialize(el: Element, depth: number, out: string[]): void {
  if (depth > 25) return;
  const pad = "  ".repeat(depth);
  const tag = el.tagName.toLowerCase();
  if (tag === "script" || tag === "style" || tag === "svg" || tag === "img") {
    out.push(`${pad}<${tag}/>`);
    return;
  }
  const attrs: string[] = [];
  const firstClass = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)[0];
  if (firstClass) attrs.push(`class="${firstClass}"`);
  for (const name of KEEP_ATTRS) {
    const value = el.getAttribute(name);
    if (value !== null) attrs.push(`${name}="${scrub(value).slice(0, 60)}"`);
  }
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style && (style.textDecorationLine.includes("line-through") || style.transform !== "none" || style.opacity === "0")) {
    attrs.push(`data-computed="${[style.textDecorationLine.includes("line-through") ? "line-through" : "", style.transform !== "none" ? `transform:${style.transform}` : "", style.opacity === "0" ? "opacity:0" : ""].filter(Boolean).join(";")}"`);
  }
  out.push(`${pad}<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>`);
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) out.push(`${pad}  ${JSON.stringify(scrub(text))}`);
    } else if (node.nodeType === 1) {
      serialize(node as Element, depth + 1, out);
    }
  }
}

export function captureOrderDom(doc: Document): string {
  const out: string[] = [
    `<!-- UPAY3FOOD DOM capture · ${new Date().toISOString()} · ${doc.location.hostname}${doc.location.pathname.replace(/[0-9a-f-]{16,}/gi, "[id]")} -->`,
    "<!-- Review before sharing: text was scrubbed automatically, but check for names or addresses. -->"
  ];
  const candidates = findSummaryCandidates(doc.body);
  if (candidates.length === 0) out.push("<!-- no Subtotal + Total container found -->");
  candidates.forEach((summary, index) => {
    // Up to 3 ancestors to include the item list and the nearest CTA.
    let region: Element = summary;
    for (let i = 0; i < 3 && region.parentElement && region.parentElement !== doc.body; i++) region = region.parentElement;
    const rect = summary.getBoundingClientRect();
    out.push(
      `<!-- candidate ${index + 1}: onScreen=${isOnScreen(summary)} rect=${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)}x${Math.round(rect.height)} -->`
    );
    serialize(region, 0, out);
  });
  return out.join("\n");
}
