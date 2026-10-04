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

## Social profiles

TBD.

## Evidence

Done:

- defined initial category (açaí, 500 ml);
- working prototype: extension (context detection, cart/checkout/Pix
  extraction, market comparison, intent + decision engine) and observation API;
- source transparency: provenance on every observation, synthetic data flagged;
- Solana integration decision: wallet → USDC → off-ramp → Pix, interfaces and
  mocks only (ADR-006).

Still required:

- real price-comparison observations captured on live iFood pages;
- calibration of the extractors against real iFood DOM;
- demo video;
- product URL.
