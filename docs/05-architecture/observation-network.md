# Distributed observation network

## Idea

Many users already see delivery prices in their own sessions. If each client
contributes the **commercial facts** it observes, the network can tell any
user how their checkout compares with recent comparable observations — without
anyone sharing accounts, credentials or personal data.

## What a client sends

Only `MarketObservation` fields: source, timestamp, coarse region, ETA,
membership, promotion scope, provenance, merchant name, item titles,
quantities, subtotal, fees, discount, total. The server **rebuilds** each
observation from an allowlist (`packages/market/src/sanitize.ts`), so unknown
fields — cookies, tokens, addresses, names, URLs — are dropped by
construction. E-mails/phones inside free text are scrubbed. Normalization is
recomputed server-side. Synthetic observations are rejected by the network.

`observerId` is a random per-install UUID, not linked to any platform account.
It is never returned by the public API.

## What the backend computes

`summarizeMarket` over fresh, comparable **cart totals**:

- lowest observed comparable price, median, highest, spread;
- freshness (newest/oldest age, freshness window);
- sample size and provenance mix;
- regional variation (by coarse region);
- account-context variation (by membership and promotion scope).

## Language

Outputs are observational: *"Your checkout is R$24,90. Comparable
observations range from R$19,90 to R$25,40."* Variation by region or account
context is reported as observed variation. The system does **not** claim
discriminatory pricing or infer causes.

## Observations are not offers

A low price observed by another client is market intelligence. It may depend
on that account's coupons, membership, address or timing. The agent marks it
`market-reference` and never presents it as executable by the current user
(ADR-005).

## Current implementation and gaps

`apps/observer-api` implements ingestion, summary and compare endpoints with
JSONL storage and per-IP rate limiting. Before any public deployment it needs:
authentication of clients, Sybil/poisoning resistance (e.g. per-observer
weighting, outlier rejection, attestation), retention policy, and a privacy
review. Merchant names are kept because they are public commercial data; if
needed they can be hashed.
