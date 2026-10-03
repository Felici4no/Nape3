# Architecture

## Architectural objective

Keep source ingestion, normalization, pricing, search, and presentation independent.

## Proposed high-level architecture

```
Delivery sources
      ↓
Connectors / imports
      ↓
RawOffer
      ↓
Normalizer
      ↓
CanonicalOffer
      ↓
Pricing engine
      ↓
Comparison/search API
      ↓
Reference web interface
```

## Suggested repository shape

```
apps/
  web/

packages/
  connectors/
  normalization/
  pricing/
  search/
  domain/

docs/
```

## Design rule

Source-specific logic must remain inside connectors.

The core domain should not know whether an offer came from iFood, Rappi, 99Food, a mock dataset, or another source.
