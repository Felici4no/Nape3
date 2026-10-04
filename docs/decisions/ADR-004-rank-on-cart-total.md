# ADR-004 — Rank on cart total, never on item price

## Status

Accepted.

## Context

The first extractor captured a single visible price. Item prices ignore
delivery fee, service fee and discounts, which often decide which option is
cheaper.

## Decision

Rankings and market statistics use `CartQuote.totalCents` only. Item-only
observations are kept as context but excluded from ranking with an explicit
reason. A cart is comparable only if every line matches the requirement and
the total quantity matches.

## Consequences

- The extension must extract subtotal, fees, discount and total per label.
- Fewer observations qualify, which is preferable to wrong comparisons.
