# Canonical offer and cart quote

Different platforms describe equivalent offers differently. Nape3 maps source
data into a common representation (`packages/domain/src/types.ts`).

## Money

All amounts are **integer cents** with an explicit `currency: "BRL"`. The
`Cents` type is branded so a bare `number` cannot be used as money.

## Item vs order

- `ProductOffer` — one item as listed (`unitPriceCents`, optional struck-through
  `originalUnitPriceCents`). Useful context, **not** what the user pays.
- `CartQuote` — the complete order:

```ts
interface CartQuote {
  source: "ifood" | "rappi" | "99food";
  merchant: { name: string };
  stage: "cart" | "checkout" | "pix-payment";
  lines: CartLine[];
  itemsSubtotalCents: Cents;
  deliveryFeeCents: Cents;
  serviceFeeCents: Cents;
  discountCents: Cents;      // positive amount subtracted
  totalCents: Cents;         // what the platform displays
  currency: "BRL";
}
```

## Effective price

```
totalCents = itemsSubtotalCents + deliveryFeeCents + serviceFeeCents − discountCents
```

The displayed total is kept as-is and **reconciled** against this formula
(`verifyCartQuote`). A mismatch is flagged (usually an unparsed fee), never
silently corrected. Ranking always uses `CartQuote.totalCents` (ADR-004).

## Canonical product

`CanonicalProduct` = category + volume + attributes + normalization metadata
(method, confidence, reasons). The original source title is always preserved.
