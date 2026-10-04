# ADR-006 — Payments: Pix via off-ramp, no token, no contract

## Status

Accepted (interfaces only).

## Decision

- No project token. No smart contract unless a concrete need appears.
- Planned route: user wallet → USDC (SPL) → licensed off-ramp → Pix payout.
- Until a licensed partner and a security review exist, only simulated
  providers can execute, and only with explicit authorization of the exact
  amount.

## Consequences

The hackathon demo shows route planning and Pix target detection, clearly
labelled as simulation.
