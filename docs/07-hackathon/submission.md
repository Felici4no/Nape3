# Submission

This document mirrors the hackathon submission as fields become known.

## Project name

UPAY3FOOD (repository and internal codename: Nape3)

## Stage

Prototype

## Team size

1 (solo, university student, Brazil)

## One-sentence description

> UPAY3FOOD finds the cheapest valid delivery checkout across platforms and funds it privately with USDC on Solana, through Cloak's shielded pool.

## Targets

Deadline: 2026-10-12 23:59 Brasília (the earliest of the published cutoffs).

| Prize | Eligibility | Registration |
| --- | --- | --- |
| Global awards and Solana track | open | Colosseum submission |
| University prize ($5k) | student builder | Colosseum submission |
| Superteam Brasil track ($5k) | Brazil base country, Solana integration | separate Earn submission |
| RPC Fast sidetrack (credits) | uses RPC Fast | separate Earn submission; terms to confirm |

See [benchmark](benchmark.md) for how this compares with past winners.

## Repository

https://github.com/Felici4no/Nape3-UPAY3FOOD

## Product URL

https://upay3food.com

## Documentation

https://docs.upay3food.com

## Social profiles

TBD.

## Evidence

Done:

- defined initial category (açaí, 500 ml);
- working prototype: extension (context detection, cart/checkout/Pix
  extraction, market comparison, intent + decision engine) and observation API;
- source transparency: provenance on every observation, synthetic data flagged;
- Solana integration decision: wallet → USDC → off-ramp → Pix (ADR-006).
- **Private funding proven on mainnet:** 1.000000 USDC shielded into Cloak from Phantom, confirmed at slot `453687294`. [Proof](../08-proofs/2026-10-05-mainnet-shield.md).
- The licensed off-ramp / Pix settlement remains intentionally disabled.

Still required:

- real price-comparison observations captured on live iFood pages;
- calibration of the extractors against real iFood DOM;
- pitch video (3 min or less) and technical demo video (3 min or less);
- traction evidence (real users, comparisons, potential savings);
- go-to-market and business plan;
- logo;
- disclosure of third-party code (adapted Cloak SDK) and of prior work.
