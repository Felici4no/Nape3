# ADR-007 — No dedicated account, no headless scraper

## Status

Accepted (2026-10-08).

## Context

More data sources are needed (see [data sources](../03-market/data-sources.md)).
One option was to create a dedicated account on each platform and keep a
headless browser scraping prices on a schedule.

## Decision

UPAY3FOOD does not run its own accounts or bots against delivery platforms.
Market data comes only from:

- users' own sessions, observe-only, through the extension (ADR-003, ADR-005);
- data restaurants share or authorize (partnerships, Open Delivery, merchant
  APIs).

## Why

- It likely breaches the platforms' consumer terms (personal, non-automated
  use; wording to confirm), and bans would break the data mid-demo.
- Bypassing anti-bot measures adds legal risk, and the incumbents litigate
  (unfair competition claims, the 2026 99Food comparative-advertising ruling).
- One bot account sees one account's prices. Coupons, membership (Clube) and
  new-user promotions make those prices unrepresentative.
- It contradicts the product's own rules: no private APIs, no cookies or
  tokens, no request interception.

## Consequences

- Coverage grows with users and merchant partners, not with servers.
- Observations from a single user are labelled `market-reference`, with time
  and context, never as an executable offer.
