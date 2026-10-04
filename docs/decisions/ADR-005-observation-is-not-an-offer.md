# ADR-005 — An observation is not an executable offer

## Status

Accepted.

## Context

Prices observed in one session can depend on that account's coupons,
membership, address and timing. Sharing sessions or credentials to "use" a
better price would be unsafe and likely against platform terms.

## Decision

- Never share or use credentials, cookies, session tokens or account control.
- Observations from other clients (or fixtures) are `market-reference`:
  displayed as market intelligence with a "verify in <platform>" note.
- Only the user's current checkout is `executable`; the agent reports the best
  executable option separately from the best observed price.

## Consequences

The product's promise is information before commitment, not automatic
arbitrage across accounts.
