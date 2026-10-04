import {
  cents,
  normalizeTitle,
  SOURCE_PLATFORMS,
  validateProvenance,
  type CartLine,
  type Cents,
  type MarketObservation,
  type Membership,
  type ObservationContext,
  type PromotionScope,
  type Provenance,
  type ProvenanceMethod,
  type QuoteStage,
  type SourcePlatform
} from "@nape3/domain";

/**
 * Allowlist sanitizer for observations sent by clients of the observation
 * network. The output is *rebuilt* field by field from known commercial data,
 * so anything else a client sends (cookies, tokens, addresses, names, raw
 * HTML, full URLs) is dropped by construction rather than filtered by name.
 */

export type SanitizeResult =
  | { ok: true; observation: MarketObservation }
  | { ok: false; errors: string[] };

const METHODS: readonly ProvenanceMethod[] = ["browser-extension", "manual", "fixture", "partner-api"];
const MEMBERSHIPS: readonly Membership[] = ["none", "ifood-club", "rappi-prime", "other", "unknown"];
const PROMOTION_SCOPES: readonly PromotionScope[] = [
  "none",
  "public",
  "first-order",
  "account-specific",
  "membership",
  "unknown"
];
const STAGES: readonly QuoteStage[] = ["cart", "checkout", "pix-payment"];

const REGION_RE = /^(BR-[A-Z]{2}(-[a-z0-9-]{1,40})?|cep:\d{3})$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TEXT = 120;
const MAX_LINES = 30;
const MAX_CENTS = 10_000_000; // R$100.000,00 — anything above is a parsing error.

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class Collector {
  errors: string[] = [];
  fail(message: string): undefined {
    this.errors.push(message);
    return undefined;
  }
}

function oneOf<T extends string>(c: Collector, value: unknown, allowed: readonly T[], field: string): T | undefined {
  return allowed.includes(value as T) ? (value as T) : c.fail(`${field}: unsupported value`);
}

/** Collapses whitespace, strips control chars and anything that looks like an e-mail/phone. */
function cleanText(c: Collector, value: unknown, field: string): string | undefined {
  if (typeof value !== "string") return c.fail(`${field}: expected string`);
  const text = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\S+@\S+\.\S+/g, "[removed]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[removed]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
  return text.length > 0 ? text : c.fail(`${field}: empty`);
}

function money(c: Collector, value: unknown, field: string, allowNegative = false): Cents | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return c.fail(`${field}: expected integer cents`);
  if (!allowNegative && value < 0) return c.fail(`${field}: negative`);
  if (Math.abs(value) > MAX_CENTS) return c.fail(`${field}: implausible amount`);
  return cents(value);
}

function minutesRange(value: unknown): { min: number; max: number } | undefined {
  if (!isObject(value)) return undefined;
  const { min, max } = value;
  if (typeof min !== "number" || typeof max !== "number") return undefined;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min || max > 600) return undefined;
  return { min, max };
}

function provenance(c: Collector, value: unknown): Provenance | undefined {
  if (!isObject(value)) return c.fail("provenance: missing");
  const method = oneOf(c, value.method, METHODS, "provenance.method");
  if (typeof value.live !== "boolean" || typeof value.synthetic !== "boolean") {
    return c.fail("provenance: live and synthetic flags are required");
  }
  if (!method) return undefined;
  const result: Provenance = { method, live: value.live, synthetic: value.synthetic };
  if (typeof value.collectorVersion === "string" && /^[\w.+-]{1,32}$/.test(value.collectorVersion)) {
    result.collectorVersion = value.collectorVersion;
  }
  // rawReference must be a page kind such as "ifood:checkout", never a URL.
  if (typeof value.rawReference === "string" && /^[a-z0-9:/_-]{1,64}$/.test(value.rawReference)) {
    result.rawReference = value.rawReference;
  }
  for (const issue of validateProvenance(result)) c.fail(`provenance: ${issue}`);
  return result;
}

function context(c: Collector, value: unknown): ObservationContext | undefined {
  if (!isObject(value)) return c.fail("context: missing");
  const membership = oneOf(c, value.membership ?? "unknown", MEMBERSHIPS, "context.membership");
  const promotionScope = oneOf(c, value.promotionScope ?? "unknown", PROMOTION_SCOPES, "context.promotionScope");
  if (!membership || !promotionScope) return undefined;
  const result: ObservationContext = { membership, promotionScope };
  if (value.marketRegion !== undefined) {
    if (typeof value.marketRegion === "string" && REGION_RE.test(value.marketRegion)) {
      result.marketRegion = value.marketRegion;
    } else {
      c.fail("context.marketRegion: must be coarse (BR-UF[-city] or cep:NNN)");
    }
  }
  const eta = minutesRange(value.etaMinutes);
  if (eta) result.etaMinutes = eta;
  return result;
}

function merchant(c: Collector, value: unknown) {
  if (!isObject(value)) return c.fail("merchant: missing");
  const name = cleanText(c, value.name, "merchant.name");
  if (!name) return undefined;
  const result: { name: string; sourceMerchantId?: string } = { name };
  if (typeof value.sourceMerchantId === "string" && ID_RE.test(value.sourceMerchantId)) {
    result.sourceMerchantId = value.sourceMerchantId;
  }
  return result;
}

function lines(c: Collector, value: unknown): CartLine[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LINES) {
    return c.fail(`quote.lines: expected 1..${MAX_LINES} lines`);
  }
  const result: CartLine[] = [];
  value.forEach((raw, index) => {
    if (!isObject(raw)) return c.fail(`quote.lines[${index}]: invalid`);
    const sourceTitle = cleanText(c, raw.sourceTitle, `quote.lines[${index}].sourceTitle`);
    const quantity = raw.quantity;
    const lineTotalCents = money(c, raw.lineTotalCents, `quote.lines[${index}].lineTotalCents`);
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return c.fail(`quote.lines[${index}].quantity: invalid`);
    }
    if (!sourceTitle || lineTotalCents === undefined) return undefined;
    // Normalization is recomputed server-side; client-claimed products are ignored.
    const line: CartLine = { sourceTitle, product: normalizeTitle(sourceTitle).product, quantity, lineTotalCents };
    const unit = raw.unitPriceCents === undefined ? undefined : money(c, raw.unitPriceCents, `quote.lines[${index}].unitPriceCents`);
    if (unit !== undefined) line.unitPriceCents = unit;
    result.push(line);
    return undefined;
  });
  return result;
}

export function sanitizeObservation(input: unknown): SanitizeResult {
  const c = new Collector();
  if (!isObject(input)) return { ok: false, errors: ["observation: expected object"] };

  const id = typeof input.id === "string" && ID_RE.test(input.id) ? input.id : c.fail("id: invalid");
  const source = oneOf<SourcePlatform>(c, input.source, SOURCE_PLATFORMS, "source");
  const observedAtMs = typeof input.observedAt === "string" ? Date.parse(input.observedAt) : Number.NaN;
  if (Number.isNaN(observedAtMs)) c.fail("observedAt: invalid timestamp");
  const prov = provenance(c, input.provenance);
  const ctx = context(c, input.context);
  const observerId =
    input.observerId === undefined
      ? undefined
      : typeof input.observerId === "string" && ID_RE.test(input.observerId)
        ? input.observerId
        : c.fail("observerId: invalid");

  const base = {
    id: id ?? "",
    source: source ?? "ifood",
    observedAt: Number.isNaN(observedAtMs) ? "" : new Date(observedAtMs).toISOString(),
    context: ctx ?? { membership: "unknown" as const, promotionScope: "unknown" as const },
    provenance: prov ?? { method: "manual" as const, live: false, synthetic: false },
    ...(observerId ? { observerId } : {})
  };

  let observation: MarketObservation | undefined;

  if (input.kind === "cart-quote") {
    const q = isObject(input.quote) ? input.quote : (c.fail("quote: missing") ?? {});
    const m = merchant(c, q.merchant);
    const ls = lines(c, q.lines);
    const stage = oneOf(c, q.stage, STAGES, "quote.stage");
    const subtotal = money(c, q.itemsSubtotalCents, "quote.itemsSubtotalCents");
    const delivery = money(c, q.deliveryFeeCents, "quote.deliveryFeeCents");
    const service = money(c, q.serviceFeeCents, "quote.serviceFeeCents");
    const discount = money(c, q.discountCents, "quote.discountCents");
    const total = money(c, q.totalCents, "quote.totalCents");
    if (q.currency !== "BRL") c.fail("quote.currency: only BRL is supported");
    if (q.source !== undefined && q.source !== source) c.fail("quote.source: differs from observation source");
    if (m && ls && stage && subtotal !== undefined && delivery !== undefined && service !== undefined && discount !== undefined && total !== undefined && source) {
      observation = {
        ...base,
        kind: "cart-quote",
        quote: {
          source,
          merchant: m,
          stage,
          lines: ls,
          itemsSubtotalCents: subtotal,
          deliveryFeeCents: delivery,
          serviceFeeCents: service,
          discountCents: discount,
          totalCents: total,
          currency: "BRL"
        }
      };
    }
  } else if (input.kind === "product-offer") {
    const o = isObject(input.offer) ? input.offer : (c.fail("offer: missing") ?? {});
    const m = merchant(c, o.merchant);
    const title = cleanText(c, o.sourceTitle, "offer.sourceTitle");
    const unit = money(c, o.unitPriceCents, "offer.unitPriceCents");
    if (o.currency !== "BRL") c.fail("offer.currency: only BRL is supported");
    if (m && title && unit !== undefined && source) {
      observation = {
        ...base,
        kind: "product-offer",
        offer: {
          source,
          merchant: m,
          sourceTitle: title,
          product: normalizeTitle(title).product,
          unitPriceCents: unit,
          currency: "BRL"
        }
      };
      const original = o.originalUnitPriceCents === undefined ? undefined : money(c, o.originalUnitPriceCents, "offer.originalUnitPriceCents");
      if (original !== undefined) observation.offer.originalUnitPriceCents = original;
    }
  } else {
    c.fail("kind: expected cart-quote or product-offer");
  }

  if (c.errors.length > 0 || !observation) return { ok: false, errors: c.errors.length ? c.errors : ["observation: invalid"] };
  return { ok: true, observation };
}
