import type { PageSnapshot } from "../shared/types";
import { findSummaryCandidates } from "./extractors/cart";
import { isOnScreen } from "./dom";

/**
 * Debug capture of the *order-summary* structure, so extractors can be
 * calibrated against real markup. Only summary candidates and their item
 * region are serialized; text is scrubbed of e-mails, phones, CEPs, long
 * digit runs and street addresses. The user reviews it before sharing.
 */

const KEEP_ATTRS = ["data-testid", "role", "aria-label", "aria-hidden", "hidden", "inert"];

/** A Pix "copia e cola" payload (EMV): carries the merchant/receiver and a transaction id. Never exported. */
const PIX_PAYLOAD = /000201\S{20,}/g;

export function scrub(text: string, redactions: readonly string[] = []): string {
  let out = text;
  for (const word of redactions) {
    const w = word.trim();
    if (w.length >= 3) out = out.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[redacted]");
  }
  return out
    .replace(PIX_PAYLOAD, (m) => `[pix-payload ${m.length} chars]`)
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[cpf]")
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

// ---------------------------------------------------------------------------
// Whole-page calibration capture (any context)
// ---------------------------------------------------------------------------

/** Page chrome that carries the user's identity or address, never the order: skipped entirely. */
const SKIP_TAGS = new Set(["header", "nav", "footer", "script", "style", "noscript", "template", "iframe", "canvas", "video", "picture"]);
const LEAF_TAGS = new Set(["svg", "img"]);
/** A list with more element children than this keeps only the first few (search results, menus). */
const LIST_KEEP = 6;
const LIST_THRESHOLD = 8;
const MAX_LINES = 6000;

/** Many siblings that look alike (same tag and first class): a results list or a menu, worth only a sample. */
function isRepetitiveList(children: Element[]): boolean {
  if (children.length <= LIST_THRESHOLD) return false;
  const signature = (el: Element) => `${el.tagName}.${(el.getAttribute("class") ?? "").split(/\s+/)[0] ?? ""}`;
  const counts = new Map<string, number>();
  for (const child of children) counts.set(signature(child), (counts.get(signature(child)) ?? 0) + 1);
  return Math.max(...counts.values()) / children.length >= 0.8;
}

interface PageCaptureOptions {
  /** Extra words to remove (the user's name, street…), typed in the popup; used once, never stored. */
  redactions?: readonly string[];
}

function serializePage(el: Element, depth: number, out: string[], redact: readonly string[]): void {
  if (out.length >= MAX_LINES) return;
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return;
  const pad = "  ".repeat(Math.min(depth, 40));
  if (LEAF_TAGS.has(tag)) {
    const label = el.getAttribute("aria-label") ?? el.getAttribute("alt");
    out.push(`${pad}<${tag}${label ? ` label=${JSON.stringify(scrub(label, redact).slice(0, 60))}` : ""}/>`);
    return;
  }
  const attrs: string[] = [];
  const firstClass = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)[0];
  if (firstClass) attrs.push(`class="${firstClass.slice(0, 40)}"`);
  for (const name of KEEP_ATTRS) {
    const value = el.getAttribute(name);
    if (value !== null) attrs.push(`${name}="${scrub(value, redact).slice(0, 60)}"`);
  }
  if (tag === "a") {
    // Route shape only: ids and query values are dropped.
    const href = (el.getAttribute("href") ?? "").split("?")[0]!.replace(/[0-9a-f-]{16,}/gi, "[id]");
    if (href) attrs.push(`href="${scrub(href, redact).slice(0, 80)}"`);
  }
  if (tag === "input" || tag === "textarea" || tag === "select") {
    // Values are never exported, only their shape.
    const value = (el as HTMLInputElement).value ?? "";
    for (const name of ["type", "name", "placeholder"]) {
      const v = el.getAttribute(name);
      if (v) attrs.push(`${name}="${scrub(v, redact).slice(0, 40)}"`);
    }
    attrs.push(`value-length="${value.length}"`);
    if (/^000201/.test(value)) attrs.push('value-kind="pix-payload"');
  }
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style) {
    const flags = [
      style.textDecorationLine.includes("line-through") ? "line-through" : "",
      style.display === "none" ? "display:none" : "",
      style.visibility === "hidden" ? "visibility:hidden" : "",
      style.opacity === "0" ? "opacity:0" : "",
      style.transform !== "none" ? `transform:${style.transform}` : "",
      style.position === "fixed" ? "fixed" : ""
    ].filter(Boolean);
    if (flags.length) attrs.push(`data-computed="${flags.join(";")}"`);
  }
  out.push(`${pad}<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>`);
  const children = Array.from(el.childNodes);
  const elementChildren = children.filter((n): n is Element => n.nodeType === 1);
  const repetitive = isRepetitiveList(elementChildren);
  let keptElements = 0;
  for (const node of children) {
    if (out.length >= MAX_LINES) break;
    if (node.nodeType === 3) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) out.push(`${pad}  ${JSON.stringify(scrub(text, redact).slice(0, 200))}`);
    } else if (node.nodeType === 1) {
      if (repetitive && keptElements >= LIST_KEEP) continue;
      keptElements++;
      serializePage(node as Element, depth + 1, out, redact);
    }
  }
  if (repetitive) out.push(`${pad}  <!-- … ${elementChildren.length - LIST_KEEP} more similar children omitted -->`);
}

function snapshotSummary(snapshot: PageSnapshot, redact: readonly string[]): string {
  // What the extension extracted, as the developer needs to compare it with the screen.
  const json = JSON.stringify(
    {
      context: snapshot.detection.context,
      confidence: snapshot.detection.confidence,
      signals: snapshot.detection.signals,
      restaurant: snapshot.restaurant ?? null,
      product: snapshot.product ?? null,
      cart: snapshot.cart ?? null,
      pix: snapshot.pix ?? null
    },
    null,
    2
  );
  return scrub(json, redact);
}

/**
 * Calibration capture of the whole page, for any context: detection,
 * extraction result and a sanitized structure of the main content and any
 * open dialog/drawer. header/nav/footer (account menu, delivery address) are
 * skipped; input values are never exported; e-mails, phones, CEPs, CPFs,
 * long numbers, street addresses, Pix payloads and the user's own redaction
 * words are scrubbed. The user reviews it before sharing.
 */
export function capturePage(doc: Document, snapshot: PageSnapshot, options: PageCaptureOptions = {}): string {
  const redact = options.redactions ?? [];
  const view = doc.defaultView;
  const path = doc.location.pathname.replace(/[0-9a-f-]{16,}/gi, "[id]");
  const queryKeys = Array.from(new URLSearchParams(doc.location.search).keys());
  const out: string[] = [
    `<!-- UPAY3FOOD page capture · ${new Date().toISOString()} · ${doc.location.hostname}${scrub(path, redact)}${queryKeys.length ? ` · query keys: ${queryKeys.join(",")}` : ""} -->`,
    `<!-- viewport ${view?.innerWidth ?? "?"}x${view?.innerHeight ?? "?"} · detected ${snapshot.detection.context} (confidence ${snapshot.detection.confidence}) -->`,
    "<!-- Review before sharing: header/nav/footer and input values are not included, and text was scrubbed, but check for your name or address. -->",
    "<!-- EXTRACTION",
    snapshotSummary(snapshot, redact),
    "-->"
  ];
  // Roots: the main content plus anything floating above it (dialogs, drawers, fixed panels) that is not inside it.
  const main = doc.querySelector("main, [role=main]") ?? doc.body;
  const floating = Array.from(doc.body.querySelectorAll('[role="dialog"], [aria-modal="true"], aside')).filter((el) => !main.contains(el));
  for (const [i, root] of [main, ...floating].entries()) {
    out.push(`<!-- root ${i + 1}: ${root === main ? "main content" : "dialog/drawer outside main"} -->`);
    serializePage(root, 0, out, redact);
  }
  if (out.length >= MAX_LINES) out.push(`<!-- truncated at ${MAX_LINES} lines -->`);
  return out.join("\n");
}
