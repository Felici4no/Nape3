import type { Decision } from "@nape3/agent";
import type { Cents, CartQuoteObservation, Membership } from "@nape3/domain";
import type { CheckoutComparison, MarketSummary } from "@nape3/market";
import type { PixBrCode } from "@nape3/payments";
import type { WalletStatus } from "./payment";

export type PageContext =
  | "SEARCH_RESULTS"
  | "RESTAURANT"
  | "PRODUCT"
  | "CART"
  | "CHECKOUT"
  | "PIX_PAYMENT"
  | "ORDER_CONFIRMATION"
  | "UNKNOWN";

/** Every extracted value carries how sure we are and what DOM text produced it. */
export interface Field<T> {
  value: T | null;
  confidence: "high" | "medium" | "low" | "missing";
  evidence: string;
}

export interface ContextDetection {
  context: PageContext;
  /** 0..1 */
  confidence: number;
  signals: string[];
}

export interface EtaRange {
  min: number;
  max: number;
}

export interface RestaurantSnapshot {
  merchantName: Field<string>;
  deliveryFeeCents: Field<Cents>;
  minimumOrderCents: Field<Cents>;
  eta: Field<EtaRange>;
}

export interface ProductSnapshot {
  title: Field<string>;
  unitPriceCents: Field<Cents>;
  originalUnitPriceCents: Field<Cents>;
}

export interface ExtractedLine {
  sourceTitle: string;
  quantity: number;
  lineTotalCents: Cents;
  evidence: string;
}

export interface CartSnapshot {
  stage: "cart" | "checkout";
  merchantName: Field<string>;
  lines: ExtractedLine[];
  itemsSubtotalCents: Field<Cents>;
  deliveryFeeCents: Field<Cents>;
  serviceFeeCents: Field<Cents>;
  discountCents: Field<Cents>;
  totalCents: Field<Cents>;
  eta: Field<EtaRange>;
  paymentMethod: Field<string>;
  /** Displayed total vs subtotal + fees − discount. */
  reconciliation: { consistent: boolean; differenceCents: number } | null;
  /**
   * A quote is valid only if it comes from one unambiguous, on-screen order
   * summary and subtotal + delivery + service − discount = total.
   * Invalid quotes are never recorded nor passed to the decision engine.
   */
  validity: { valid: boolean; reasons: string[] };
  /** How the order-summary container was chosen (debug). */
  summarySelection: {
    candidates: number;
    chosen: string | null;
    rejected: string[];
  };
}

export interface PixSnapshot {
  pixOptionVisible: boolean;
  copyPastePayload: Field<string>;
  parsedPayload: PixBrCode | null;
  qrCodePresent: boolean;
  pixKey: Field<string>;
  amountCents: Field<Cents>;
  expiresAt: Field<string>;
  /** Strongest evidence available: payload > QR > key. */
  preferredEvidence: "pix-copy-paste" | "qr-code" | "pix-key" | null;
}

export interface PageSnapshot {
  source: "ifood";
  /** Unique per extraction; lets the UI prove the data is fresh. */
  snapshotId: string;
  /** Extraction timestamp. */
  capturedAt: string;
  /** Page kind only (e.g. "ifood:checkout"); never the URL, which can carry tokens. */
  pageRef: string;
  detection: ContextDetection;
  restaurant?: RestaurantSnapshot;
  product?: ProductSnapshot;
  cart?: CartSnapshot;
  pix?: PixSnapshot;
}

// ---------------------------------------------------------------------------
// Settings & messages
// ---------------------------------------------------------------------------

export interface ExtensionSettings {
  /** Coarse region chosen by the user, e.g. "BR-SP-sao-paulo". */
  marketRegion?: string;
  membership: Membership;
  /** Explicit opt-in: also compare against synthetic fixtures (demo, flagged). Off by default. */
  includeFixtures: boolean;
  /** Optional observation network endpoint; nothing is uploaded when unset. */
  networkEndpoint?: string;
  /** agent-api runtime; when set, this browser acts as the executor of agent runs (revalidation, checkout, Pix). */
  agentApiUrl?: string;
  /** Read token for the observer network (OBSERVER_READ_TOKEN); not needed for a local observer. */
  networkReadToken?: string;
  /** Show timestamps, evidence and container selection in the popup and badge. */
  debug: boolean;
  /** On-page badge (experimental, off by default: injecting into iFood's React tree is risky). */
  showBadge: boolean;
  /** UPAY3FOOD Pay page (apps/web /pay). The checkout is fetched from the extension by id, never put in the URL. */
  fundingAppUrl: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  membership: "unknown",
  includeFixtures: false,
  debug: false,
  showBadge: false,
  fundingAppUrl: "http://localhost:3000/pay"
};

export interface MarketView {
  summary: MarketSummary;
  comparison: CheckoutComparison | null;
  observation: CartQuoteObservation | null;
  /** Why no observation was recorded (missing fields, wrong context…). */
  notRecordedReason: string | null;
}

export type ExtensionMessage =
  | { type: "GET_SNAPSHOT" }
  | { type: "GET_DOM_CAPTURE" }
  | { type: "GET_PAGE_CAPTURE"; redactions: string[] }
  | { type: "RECORD_SNAPSHOT"; snapshot: PageSnapshot; tabId?: number }
  | { type: "PLAN_INTENT"; request: string; snapshot: PageSnapshot | null }
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: ExtensionSettings }
  | { type: "CLEAR_OBSERVATIONS" }
  | { type: "CREATE_PAYMENT"; snapshot: PageSnapshot }
  | { type: "GET_WALLET_STATUS" };

export type ExtensionResponse =
  | { ok: true; type: "SNAPSHOT"; snapshot: PageSnapshot }
  | { ok: true; type: "MARKET"; market: MarketView }
  | {
      ok: true;
      type: "PLAN";
      decision: Decision | null;
      intentError: string | null;
      agentState: string;
      notes: string[];
      /** Whether the page's checkout was given to the decision engine, and why not. */
      currentCheckout: { used: boolean; reason: string | null };
    }
  | { ok: true; type: "SETTINGS"; settings: ExtensionSettings }
  | { ok: true; type: "DONE" }
  | { ok: true; type: "DOM_CAPTURE"; capture: string }
  | { ok: true; type: "PAGE_CAPTURE"; capture: string }
  | { ok: true; type: "PAYMENT_CREATED"; paymentId: string; url: string }
  | { ok: true; type: "WALLET_STATUS"; status: WalletStatus | null }
  | { ok: false; error: string };
