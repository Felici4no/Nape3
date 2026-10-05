# Spike: delivery context + search discovery on real iFood

Status: **open**. Nothing in the new discovery layer is implemented until this
spike is answered. The existing runtime, `CartQuote`, extractors, executor,
revalidation, checkout/Pix and payments stay as they are.

## What we need to learn

Q1. **How does iFood know where to deliver?** When the address changes, what
    changes that the extension can *see*:
    - the URL (path segment, query parameter, nothing);
    - the header / address picker;
    - the restaurant list?

Q2. **What is the least invasive way** for an address typed in UPAY3FOOD to
    control the region of an iFood search, given these constraints:
    - the extension stays read-only on the DOM;
    - no cookies, storage, network interception or private APIs?

Q3. **What does a search result page show** without opening each store, in
    the "Lojas" (stores) and "Itens" (items) views?
    - merchant;
    - item title;
    - item price;
    - delivery fee;
    - ETA;
    - distance;
    - "closed" state;
    - promotions / struck-through prices.

Q4. **Is a search URL stable and shareable?** If we navigate to the same
    search URL, do we get the same list for the same address?

Q5. **How do results react to an address change:**
    - immediate re-render;
    - full reload;
    - an "address out of range" state?

Q6. **What does "store doesn't deliver here" or "closed" look like**, so the
    scout can discard it without opening it?

## Hard constraints (also for the implementation)

- Never read, copy or store cookies, tokens, local/session storage or
  network traffic. No private iFood APIs. No clicks automated on iFood. The
  extension only reads visible content, and may navigate a tab to a URL (as
  the executor already does).
- The raw address never reaches the agent-api, the event log, analytics or
  logs. This has to be guaranteed by code (types + a test that fails if
  address text reaches a persisted event), not by intention.
- Captures exported for this spike are sanitized:
  - header, nav and footer are structure only (interface words kept, any
    other text replaced by its length);
  - query values are described by shape (`latitude=number(6 decimals)`),
    never by value;
  - input values are never exported;
  - e-mails, phones, CEPs, CPFs, long numbers, street addresses and Pix
    payloads are scrubbed;
  - the popup also removes extra words you type (your name, your street).

## Protocol (you drive, the extension captures)

Extension: rebuild from this branch, Settings → Debug mode on. For every step:
1. Popup → **Capture this page**, with your name and street typed into
   "Extra words to remove".
2. Review the text, download the `.txt`, send it.
3. Add one line of what the screen shows.

| # | Where | Action | Capture |
|---|-------|--------|---------|
| 1 | Home, address A | nothing | `home-A` |
| 2 | Search "açaí" | type it in iFood's own search box | `search-A-lojas`, then the **Itens** tab: `search-A-itens` |
| 3 | Address picker | open it (do not change yet) | `picker-open` |
| 4 | Change to address B (another region, e.g. work) | via iFood's picker | `home-B` |
| 5 | Same search "açaí" | | `search-B-lojas`, `search-B-itens` |
| 6 | Paste the search URL from step 2 into the address bar (still on B) | | `search-url-reload` |
| 7 | A store that is closed or out of range, if any appear | | `store-unavailable` |
| 8 | Switch back to address A | | none, just tell me if it worked |

Also tell me, in words:
- did the URL change between A and B (the capture shows its shape)?
- did the page reload or only re-render?
- did the list change?

## What each answer unlocks

| Finding | Mechanism for "UPAY3FOOD address → iFood region" | Invasiveness |
|---|---|---|
| Location is in the URL (path region or coordinates) | Scout navigates to a search URL built for the region. Needs the region/coords derived from the address. Deriving coordinates means a geocoder, so **the address would leave the device**: to be decided explicitly. | Low (navigation only) |
| Location is only session state (set through the picker) | `BROWSER_NEEDS_USER`: "Select *this address* in iFood". The extension verifies **locally** that the visible delivery address matches the one typed in UPAY3FOOD; only `addressMatches: true/false` crosses to the agent-api. | Lowest. The user sets it; we only read. |
| Picker only works through clicks we would have to automate | Rejected: the extension stays read-only. Falls back to the row above. | — |

Whatever the mechanism, discovery then uses the same contract:
`DISCOVER_MARKET → SEARCH_PRODUCTS → READ_SEARCH_RESULTS → INSPECT_CANDIDATE`.

These are new executor commands answered from search-result and store pages.
They need a `SEARCH_RESULTS` extractor, which **does not exist yet**: today
the context is detected but nothing is extracted from it. Q3 decides what it
can read.

Progressive narrowing then reuses the existing decision engine, with only the
source of candidates changing:

stores found → compatible item → competitive → deep-inspected (store or
product page) → cart quote (2–3) → lowest total.

A hard cap on navigations per run keeps the scout at human pace.

## Findings

_To be filled from the captures._

| Q | Answer | Evidence (capture) |
|---|--------|--------------------|
| Q1 | | |
| Q2 | | |
| Q3 | | |
| Q4 | | |
| Q5 | | |
| Q6 | | |
