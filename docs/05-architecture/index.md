# Architecture

## Objective

Keep source ingestion, normalization, pricing, market aggregation, decision
and presentation independent.

```
iFood page (user's own session)
      ↓  read-only DOM
detectPageContext → extractRestaurant / Product / Cart / Checkout / PixPayment
      ↓  PageSnapshot (fields + confidence + evidence, no URL)
snapshotToObservation → sanitizeObservation (allowlist)
      ↓  MarketObservation {source, observedAt, context, provenance, quote}
local store (chrome.storage) ──optional──► observer-api (network)
      ↓
summarizeMarket (cart totals only, fresh, comparable, provenance policy)
      ↓
parseIntent → decide (hard constraints → explainable score) → state machine
      ↓
popup / Shadow DOM badge  ── user confirmation ──►  payments router (mock)
```

## Repository shape

```
apps/extension      apps/observer-api
packages/domain     packages/market     packages/agent
packages/fixtures   packages/payments
```

## Design rules

- Source-specific logic stays in the extension's extractors; the domain does
  not know whether an observation came from iFood, a fixture or an API.
- Packages are TypeScript sources consumed through the pnpm workspace; Vite
  bundles them into the extension, `tsx` runs the API.
- Every extracted field carries `confidence` and DOM `evidence`.

See also: [connectors](connectors.md), [observation network](observation-network.md),
[agent](agent.md), [payments](payments.md).
