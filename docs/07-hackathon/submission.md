# Submission

This document mirrors the hackathon submission as fields become known.

## Project name

Nape3

## Stage

Prototype

## Team size

1

## One-sentence description

Draft:

> Nape3 compares equivalent offers across delivery platforms so users can search fragmented delivery markets as one market.

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
- demo video;
- demo video.
