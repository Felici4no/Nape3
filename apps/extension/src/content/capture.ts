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

/** Never serialized. */
const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "iframe", "canvas", "video", "picture"]);
/**
 * Page chrome (account menu, the delivery-address picker): serialized as
 * structure only. Text survives only when it is interface vocabulary;
 * anything else (the address itself, the user's name) becomes its length.
 */
const CHROME_TAGS = new Set(["header", "nav", "footer"]);
const UI_WORDS =
  /^(entrega|entregar( em| para)?|endere[cç]o( de entrega)?|retirada|retirar|alterar|trocar|escolher|selecionar|buscar|busca|pesquisar|in[ií]cio|restaurantes|mercados|farm[aá]cias?|bebidas|pets|shopping|perfil|conta|entrar|sair|pedidos|meus pedidos|sacola|cupons?|ajuda|favoritos|notifica[cç][oõ]es|pagamento|agora|agendar|casa|trabalho|outro|novo endere[cç]o|usar minha localiza[cç][aã]o|confirmar( localiza[cç][aã]o)?|salvar|voltar|fechar)[:.!?]?$/i;

function chromeText(text: string): string {
  return UI_WORDS.test(text) ? text : `[text ${text.length} chars]`;
}
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

/** A machine token (role, type, test id, generated id), not user text. */
const TOKEN = /^[\w:.-]{0,40}$/;

/** Widget state a UI automation would rely on (address picker, autocomplete, tabs). Values are short tokens, never user text. */
const WIDGET_ATTRS = ["aria-expanded", "aria-haspopup", "aria-controls", "aria-autocomplete", "aria-selected", "aria-activedescendant", "aria-current", "aria-busy", "autocomplete", "id"];

interface PageCaptureOptions {
  /** Extra words to remove (the user's name, street…), typed in the popup; used once, never stored. */
  redactions?: readonly string[];
  /**
   * Structure only: every text node and label outside the interface
   * vocabulary becomes its length, on the whole page (not just the chrome).
   * For states that show the user's own address (the picker, autocomplete).
   */
  structureOnly?: boolean;
}

function serializePage(el: Element, depth: number, out: string[], redact: readonly string[], chrome = false): void {
  // (chrome = structure-only for this subtree)
  if (out.length >= MAX_LINES) return;
  const tag = el.tagName.toLowerCase();
  if (SKIP_TAGS.has(tag)) return;
  if (CHROME_TAGS.has(tag)) chrome = true;
  /** Inside page chrome nothing free-form survives, only interface words. */
  const text = (value: string) => (chrome ? chromeText(value) : scrub(value, redact));
  const pad = "  ".repeat(Math.min(depth, 40));
  if (LEAF_TAGS.has(tag)) {
    const label = el.getAttribute("aria-label") ?? el.getAttribute("alt");
    out.push(`${pad}<${tag}${label ? ` label=${JSON.stringify(text(label).slice(0, 60))}` : ""}/>`);
    return;
  }
  const attrs: string[] = [];
  const firstClass = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)[0];
  if (firstClass) attrs.push(`class="${firstClass.slice(0, 40)}"`);
  for (const name of KEEP_ATTRS) {
    const value = el.getAttribute(name);
    // role, data-testid, hidden… are machine tokens; only aria-label carries words.
    if (value !== null) attrs.push(`${name}="${(name === "aria-label" ? text(value) : TOKEN.test(value) ? value : text(value)).slice(0, 60)}"`);
  }
  for (const name of WIDGET_ATTRS) {
    const value = el.getAttribute(name);
    // Ids and references are kept only when they look like generated tokens, not words.
    if (value !== null && TOKEN.test(value)) attrs.push(`${name}="${value}"`);
  }
  if (tag === "a") {
    // Route shape only: ids and query values are dropped.
    const href = (el.getAttribute("href") ?? "").split("?")[0]!.replace(/[0-9a-f-]{16,}/gi, "[id]");
    if (href) attrs.push(`href="${scrub(href, redact).slice(0, 80)}"`); // a route shape, never free text
  }
  if (tag === "input" || tag === "textarea" || tag === "select") {
    // Values are never exported, only their shape.
    const value = (el as HTMLInputElement).value ?? "";
    for (const name of ["type", "name", "placeholder"]) {
      const v = el.getAttribute(name);
      if (v) attrs.push(`${name}="${(name !== "placeholder" && TOKEN.test(v) ? v : text(v)).slice(0, 40)}"`);
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
      style.transform && style.transform !== "none" ? `transform:${style.transform}` : "",
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
      const value = (node.textContent ?? "").replace(/\s+/g, " ").trim();
      if (value) out.push(`${pad}  ${JSON.stringify(text(value).slice(0, 200))}`);
    } else if (node.nodeType === 1) {
      if (repetitive && keptElements >= LIST_KEEP) continue;
      keptElements++;
      serializePage(node as Element, depth + 1, out, redact, chrome);
    }
  }
  if (repetitive) out.push(`${pad}  <!-- … ${elementChildren.length - LIST_KEEP} more similar children omitted -->`);
}

/** What kind of value a query parameter holds, never the value (coordinates and ids would locate or identify). */
export function valueShape(value: string): string {
  if (value === "") return "empty";
  if (/^-?\d+$/.test(value)) return `integer(${value.replace("-", "").length} digits)`;
  if (/^-?\d+\.\d+$/.test(value)) return `number(${value.split(".")[1]!.length} decimals)`;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return "uuid";
  if (/^-?\d+\.\d+,-?\d+\.\d+$/.test(value)) return "coordinate-pair";
  return `text(${value.length})`;
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
  const structureOnly = options.structureOnly ?? false;
  const view = doc.defaultView;
  // SPA or full reload: a reload resets the page clock; an SPA transition does not.
  const nav = view?.performance?.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
  const pageAgeSeconds = view?.performance ? Math.round(view.performance.now() / 1000) : null;
  const path = doc.location.pathname.replace(/[0-9a-f-]{16,}/gi, "[id]");
  const queryKeys = Array.from(new URLSearchParams(doc.location.search).entries()).map(([key, value]) => `${key}=${valueShape(value)}`);
  const out: string[] = [
    `<!-- UPAY3FOOD page capture · ${new Date().toISOString()} · ${doc.location.hostname}${scrub(path, redact)}${queryKeys.length ? ` · query: ${queryKeys.join(", ")}` : ""} -->`,
    `<!-- viewport ${view?.innerWidth ?? "?"}x${view?.innerHeight ?? "?"} · detected ${snapshot.detection.context} (confidence ${snapshot.detection.confidence}) -->`,
    `<!-- page loaded ${pageAgeSeconds ?? "?"} s ago · navigation type ${nav?.type ?? "unknown"} · history length ${view?.history?.length ?? "?"}${structureOnly ? " · STRUCTURE ONLY" : ""} -->`,
    "<!-- Review before sharing: header/nav/footer and input values are not included, and text was scrubbed, but check for your name or address. -->",
    ...(structureOnly ? ["<!-- EXTRACTION omitted (structure only) -->"] : ["<!-- EXTRACTION", snapshotSummary(snapshot, redact), "-->"])
  ];
  // Roots: the main content plus anything floating above it (dialogs, drawers, fixed panels) that is not inside it.
  const main = doc.querySelector("main, [role=main]") ?? doc.body;
  const outside = (el: Element) => el !== main && !main.contains(el) && !el.parentElement?.closest("header, nav, footer, [role=dialog], [aria-modal=true], aside");
  const chrome = main === doc.body ? [] : Array.from(doc.body.querySelectorAll("header, nav, footer")).filter(outside);
  const floating = Array.from(doc.body.querySelectorAll('[role="dialog"], [aria-modal="true"], aside')).filter(outside);
  const roots: Array<[Element, string]> = [
    ...chrome.map((el): [Element, string] => [el, `page chrome <${el.tagName.toLowerCase()}> (structure only)`]),
    [main, "main content"],
    ...floating.map((el): [Element, string] => [el, "dialog/drawer outside main"])
  ];
  for (const [i, [root, label]] of roots.entries()) {
    out.push(`<!-- root ${i + 1}: ${label} -->`);
    serializePage(root, 0, out, redact, structureOnly);
  }
  if (out.length >= MAX_LINES) out.push(`<!-- truncated at ${MAX_LINES} lines -->`);
  return out.join("\n");
}
