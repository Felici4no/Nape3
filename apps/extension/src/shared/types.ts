export type OfferSource = "ifood";

export interface RawOffer {
  source: OfferSource;
  url: string;
  merchantName: string | null;
  productName: string | null;
  itemPriceCents: number | null;
  observedAt: string;
  extraction: {
    productName: "h1" | "document-title" | "missing";
    itemPrice: "visible-price-text" | "missing";
    merchantName: "visible-heading" | "missing";
  };
}

export type ExtensionMessage =
  | { type: "GET_CURRENT_OFFER" }
  | { type: "SAVE_OFFER"; payload: RawOffer };

export type ExtensionResponse =
  | { ok: true; offer?: RawOffer }
  | { ok: false; error: string };
