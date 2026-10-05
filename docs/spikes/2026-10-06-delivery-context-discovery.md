# Spike: applying an ephemeral delivery address to the iFood session

Status: **open**. The Browser Scout and the discovery architecture are not
implemented until this spike is answered. The runtime, `CartQuote`,
extractors, executor, revalidation, checkout/Pix and payments stay as they are.

## Product requirement (revised 2026-10-06)

```
address typed ONCE in UPAY3FOOD (never persisted)
  ↓ transient browser operation
iFood delivery context configured
  ↓ raw address discarded
market discovery for that address
```

**Making the user select or retype the address in iFood is a development
fallback, not the product solution.** `BROWSER_NEEDS_USER` for the address
is only acceptable while developing, or as a last-resort error state.

## The new extension boundary

The extension is no longer strictly read-only. It becomes the browser
executor for **discovery**, and stays an observer for **commerce**.

| DISCOVERY: may act | COMMERCE: observe only / ask the user |
|---|---|
| open pages, navigate between results | confirm an order, "Fazer pedido", "Pagar" |
| open the address picker | run the checkout |
| type the address UPAY3FOOD received | authorize a payment, sign a wallet transaction |
| choose the matching autocomplete suggestion | apply a coupon automatically |
| type a search query | add/remove products without the user's confirmation |
| open restaurants and products, read results | anything that creates a financial obligation |

When this is implemented, it will be enforced by code, not by convention:
- an allowlist of actionable elements per discovery command;
- a denylist of commerce controls, matched by visible label and role,
  refused even if a command asks for them;
- tests proving each forbidden control is never clicked.

The extension README and the decision record change in the same commit as
that code.

## Address lifecycle (invariants for the implementation)

- **In:** typed on the UPAY3FOOD page. It goes **from the page straight to
  the extension** (`externally_connectable` message), **not through the
  agent-api**.
- **Held:** in the extension's memory for the duration of the address
  operation only. Not `chrome.storage` (local or sync), not the event log,
  not Postgres, not analytics, not logs, not fixtures, not captures.
- **Out:** discarded as soon as the delivery context is confirmed applied.
  The agent-api receives only `{ deliveryContextApplied: true }` (plus,
  possibly, a coarse non-identifying label such as a city, to be decided).
- **Guarantees by code:**
  - the address is a branded type that the event-log and logger APIs do not
    accept;
  - a test fails if address text reaches a persisted event, a log line or an
    outgoing agent-api request;
  - captures run in structure-only mode while the picker is open.

## The four paths to compare

| # | Path | What has to be true | Address exposure | Reliability risk |
|---|------|---------------------|------------------|------------------|
| 1 | **UI automation** of iFood's own picker: open it → type → autocomplete → select → confirm | The picker is reachable from any page; the input is a combobox whose suggestions can be matched to the typed address; selection updates the market without a full reload, or after a predictable one | iFood only (the user's own account, the same as typing it there) | Medium: depends on picker markup, which we calibrate with captures and pin with fixtures |
| 2 | **Navigation / deep link**: a visible URL or route that carries location | Location (region slug or coordinates) appears in a URL the scout can build | None beyond iFood, if the URL takes a region/slug the address maps to without a third party | Low if it exists; often it doesn't, or it needs coordinates (see 3) |
| 3 | **Geocoding** before opening iFood | Path 2 accepts coordinates, and coordinates are the only missing piece | **The address is sent to the geocoding provider.** This needs an explicit decision and disclosure. | Low technically; a privacy cost |
| 4 | **Session context verification**: after any of the above, confirm the context was applied | The header / address chip shows the selected address, or a stable fragment of it, as visible text | None: compared locally in the extension, never exported | Low: reading visible text the extension already reads |

Path 4 is not an alternative; it is the success check for 1–3. The
extension compares the visible delivery address with the in-memory one
(normalized street + number) and only the boolean leaves the extension.

Excluded in every path:
- private iFood APIs, or reproducing authenticated requests;
- reading cookies, local/session storage, tokens or credentials;
- network interception.

## What the spike must answer

- **A1.** Where is the address picker, and how is it opened? Header chip,
  button, `aria-haspopup`, a dialog or a page?
- **A2.** Is the address input a combobox with autocomplete:
  - roles and `aria-*`;
  - after how many characters suggestions appear;
  - do suggestions carry the street and number;
  - is there a "number" step after picking a street?
- **A3.** After selection: is there a confirmation step (map pin, "Confirmar
  localização", complement field)?
- **A4.** SPA or full reload? Watch the URL, navigation type and page age in
  the capture header.
- **A5.** Does the URL change at all with the address (path slug, query
  shape)? This decides whether path 2 exists.
- **A6.** After the change, does the visible header show the new address,
  so path 4 can verify it?

## Captures (4 states first)

Rebuild the extension from this branch; turn on Settings → Debug mode.

| # | State | Mode | File |
|---|-------|------|------|
| 1 | Home, delivering to address A | normal (name and street in "Extra words to remove") | `1-home-A` |
| 2 | Address picker open, nothing typed | **Structure only** | `2-picker-open` |
| 3 | Picker with part of a new address B typed, suggestions visible | **Structure only** | `3-picker-typing` |
| 4 | Home after address B was selected and confirmed | normal (A and B words in "Extra words to remove") | `4-home-B` |

Also say in words:
- how many steps there were between typing and the home updating (pick a
  suggestion, type the number, confirm on a map…);
- whether the page visibly reloaded.

Search, restaurants and stores come after this, once the address mechanism
is known.

## Findings

_To be filled from the captures._

| Q | Answer | Evidence |
|---|--------|----------|
| A1 | | |
| A2 | | |
| A3 | | |
| A4 | | |
| A5 | | |
| A6 | | |

**Recommended path:** _pending_
