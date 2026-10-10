import type { Cents, Currency } from "./money";

export type SourcePlatform = "ifood" | "rappi" | "99food";

export const SOURCE_PLATFORMS: readonly SourcePlatform[] = ["ifood", "rappi", "99food"];

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export type ProductCategory = "acai" | "burger" | "pizza" | "sushi";

export const PRODUCT_CATEGORIES: readonly ProductCategory[] = ["acai", "burger", "pizza", "sushi"];

/** Pizza size as sold in Brazil (cm vary by shop; the name is what customers compare). */
export type PizzaSize = "broto" | "media" | "grande" | "familia";

/**
 * Normalized description of *what* is being bought, independent of the
 * platform's naming. Comparisons only happen between equal canonical keys.
 */
export interface CanonicalProduct {
  category: ProductCategory;
  /** Volume of one unit in millilitres, when the category is volume-defined (açaí). */
  volumeMl?: number;
  /** Pizza size. */
  size?: PizzaSize;
  /** Pieces in a sushi combo. */
  pieces?: number;
  /** Free-form normalized attributes (e.g. toppings) kept for explainability. */
  attributes: Record<string, string | number | boolean>;
  normalization: {
    method: "deterministic" | "manual" | "model-assisted";
    /** 0..1 — how sure the normalizer is that the mapping is right. */
    confidence: number;
    /** Human-readable reasons for the mapping (or for low confidence). */
    reasons: string[];
  };
}

export interface MerchantRef {
  name: string;
  /** The platform's merchant id (for iFood, the UUID in the restaurant URL). */
  sourceMerchantId?: string;
  /** Public restaurant path on the platform (no query or hash), e.g. /delivery/<city>/<slug>/<uuid>. */
  sourcePath?: string;
}

/** A single item as listed by a platform (item-level price only). */
export interface ProductOffer {
  source: SourcePlatform;
  merchant: MerchantRef;
  /** Title exactly as shown by the source — never overwritten by normalization. */
  sourceTitle: string;
  sourceOfferId?: string;
  product: CanonicalProduct | null;
  unitPriceCents: Cents;
  /** Struck-through "from" price, when the source shows a promotion. */
  originalUnitPriceCents?: Cents;
  currency: Currency;
}

// ---------------------------------------------------------------------------
// Fulfillment & cart
// ---------------------------------------------------------------------------

export interface FulfillmentOption {
  mode: "delivery" | "pickup";
  etaMinutes?: { min: number; max: number };
  deliveryFeeCents: Cents;
  currency: Currency;
}

export interface CartLine {
  sourceTitle: string;
  product: CanonicalProduct | null;
  quantity: number;
  unitPriceCents?: Cents;
  lineTotalCents: Cents;
}

export type QuoteStage = "cart" | "checkout" | "pix-payment";

/**
 * A complete order quote. This — not the item price — is what users pay and
 * what the decision engine ranks on (`totalCents`).
 */
export interface CartQuote {
  source: SourcePlatform;
  merchant: MerchantRef;
  stage: QuoteStage;
  lines: CartLine[];
  itemsSubtotalCents: Cents;
  deliveryFeeCents: Cents;
  serviceFeeCents: Cents;
  /** Positive number: the amount subtracted from the order. */
  discountCents: Cents;
  totalCents: Cents;
  currency: Currency;
  fulfillment?: FulfillmentOption;
}

// ---------------------------------------------------------------------------
// Observations & provenance
// ---------------------------------------------------------------------------

export type ProvenanceMethod = "browser-extension" | "manual" | "fixture" | "partner-api";

export interface Provenance {
  method: ProvenanceMethod;
  /** Observed in real time from a real session/API (not retyped later). */
  live: boolean;
  /** Fabricated data (fixtures, demos). Never presented as a real observation. */
  synthetic: boolean;
  collectorVersion?: string;
  /** Source page kind or document reference; never a URL with personal tokens. */
  rawReference?: string;
}

export type Membership = "none" | "ifood-club" | "rappi-prime" | "other" | "unknown";

export type PromotionScope =
  | "none"
  | "public"
  | "first-order"
  | "account-specific"
  | "membership"
  | "unknown";

export interface ObservationContext {
  /** Coarse region only (e.g. "BR-SP-sao-paulo" or a 3-digit CEP prefix). */
  marketRegion?: string;
  etaMinutes?: { min: number; max: number };
  membership: Membership;
  promotionScope: PromotionScope;
}

interface ObservationBase {
  id: string;
  source: SourcePlatform;
  observedAt: string;
  context: ObservationContext;
  provenance: Provenance;
  /**
   * Random per-install id used only to tell "observed by this client" from
   * "observed elsewhere". It is not linked to any platform account.
   */
  observerId?: string;
}

export interface ProductOfferObservation extends ObservationBase {
  kind: "product-offer";
  offer: ProductOffer;
}

export interface CartQuoteObservation extends ObservationBase {
  kind: "cart-quote";
  quote: CartQuote;
}

export type MarketObservation = ProductOfferObservation | CartQuoteObservation;

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

export interface PurchaseIntent {
  request: string;
  product: {
    category: ProductCategory;
    volumeMl?: number;
    size?: PizzaSize;
    pieces?: number;
    quantity: number;
  };
  budget: {
    targetCents?: Cents;
    maxCents?: Cents;
    currency: Currency;
  };
  preferences: {
    priceWeight: number;
    etaWeight: number;
  };
  execution: {
    requireConfirmation: true;
  };
  parsing: {
    method: "deterministic" | "model-assisted";
    /** Pieces of the request that were not understood. */
    unparsed: string[];
    /** Fields the agent needed but the user did not state. */
    missing: string[];
    /** Interpretation choices the parser made, in plain language. */
    notes: string[];
  };
}
