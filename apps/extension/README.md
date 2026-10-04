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

- **Order-summary container.** Every element that is the nearest ancestor of a
  "Subtotal" label holding a "Total" label is a candidate. Candidates that are
  not on screen (off-canvas drawers, `opacity: 0`, `inert`, hidden) are
  rejected. Among the rest, the one whose *nearest* call-to-action matches
  the context wins ("Fazer pedido" at checkout, "Escolher forma de pagamento"
  in the bag). Several on-screen candidates with different totals → the quote
  is **invalid** (ambiguous), never guessed.
- Fees are bound to their labels inside that container; struck-through
  prices are ignored; "Grátis" = R$0,00; "Cupom …"/"Desconto …" rows are read
  as a positive discount; absent optional rows are assumed R$0,00 (`low`).
- **Validity gate.** A quote is valid only if `subtotal + delivery + service −
  discount = total` exactly and the item lines (quantity: `2x`, `2 x`, `2×`,
  `x2`, `2 un.`) add up to the subtotal (line totals, or unit price × qty).
  Invalid quotes are shown as *Not validated*, never recorded, never sent to
  the decision engine; no item price is ever shown in place of a total.
- **SPA.** The content script re-extracts on DOM, attribute (class, style,
  hidden, aria-*) and route changes (400 ms debounce, 2 s max wait). Each new
  valid state of the same cart (same observer + source + merchant, 60 min)
  **replaces** the previous one in storage. Out-of-order snapshots are ignored.
- The popup always requests a fresh extraction from the page (`GET_SNAPSHOT`);
  it never displays cached background state as the current checkout.

## Debug mode

Settings → *Debug mode*: extraction timestamp, snapshot id, `observedAt`,
context signals, chosen/rejected summary containers, validity reasons and the
DOM evidence of every field. *Capture order DOM* exports the structure of the
summary containers (scrubbed of e-mails, phones, CEPs, long numbers and
addresses — review before sharing) to calibrate against real iFood markup.

## Privacy & safety

- Never modifies iFood's DOM. The badge lives in a closed Shadow DOM on its
  own `<upay3food-agent-badge>` element.
- Never reads cookies, storage, tokens or network traffic; never automates
  checkout or payment.
- Observations are stored in `chrome.storage.local`. Upload happens only if
  the user sets an endpoint (permission requested at runtime;
  `credentials: "omit"`).

## Known limitations

- Labels, CTAs and URL hints are **assumptions** modelled on iFood web and
  tested on synthetic HTML (`test/fixtures`), including the regression
  `checkout-stale-drawer.html` (bag drawer left mounted off-screen after the
  SPA transition). They have not been verified against real iFood markup:
  use Debug mode → *Capture order DOM* on a real checkout and add it as a
  fixture.
- Only açaí with a known volume is compared.
- Discount scope (public vs account-specific) cannot be seen; recorded as `unknown`.
