# UPAY3FOOD.agent — browser extension

Reads the iFood page the user is on (read-only), detects the page context,
extracts the order, records a `MarketObservation` locally and compares the
checkout with recent comparable observations.

## Run

```bash
pnpm install
pnpm build:extension   # → apps/extension/dist
```

Chrome → `chrome://extensions` → Developer mode → **Load unpacked** →
`apps/extension/dist`.

## Page contexts

`SEARCH_RESULTS · RESTAURANT · PRODUCT · CART · CHECKOUT · PIX_PAYMENT ·
ORDER_CONFIRMATION · UNKNOWN` — detected from URL hints + visible pt-BR labels
(`src/content/context.ts`). The popup header shows the context; hover it to
see the signals that fired.

## Extraction

- Fees are bound to their **labels inside the order-summary container** (the
  smallest element holding "Subtotal" and "Total"); struck-through prices are
  ignored; "Grátis" = R$0,00; missing optional rows are assumed R$0,00 with
  `low` confidence and validated by reconciliation.
- Item lines are only trusted if they add up to the subtotal.
- Product prices are read inside the open product dialog only.
- Pix: visible Copia e Cola payload (CRC-checked) > QR presence > visible key.
- Every field has `confidence` and `evidence`; the snapshot stores a page
  kind (`ifood:checkout`), never the URL.

## Privacy & safety

- Never modifies iFood's DOM. The badge lives in a closed Shadow DOM on its
  own `<upay3food-agent-badge>` element.
- Never reads cookies, storage, tokens or network traffic; never automates
  checkout or payment.
- Observations are stored in `chrome.storage.local`. Upload happens only if
  the user sets an endpoint (permission requested at runtime;
  `credentials: "omit"`).

## Known limitations

- Labels and URL hints are **assumptions** modelled on iFood web and tested
  on synthetic HTML (`test/fixtures`). Calibrate on real pages: hover the
  confidence chips in the popup to see what DOM text each value came from.
- Only açaí with a known volume is compared.
- Discount scope (public vs account-specific) cannot be seen; recorded as `unknown`.
