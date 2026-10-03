# ADR-003 — Data provenance must be explicit

## Status

Accepted.

## Context

The hackathon may begin with controlled or manually collected data while live integrations are investigated.

Mixing synthetic, manual, and live data would make results misleading.

## Decision

Every offer and observation must preserve provenance.

Minimum provenance fields:

- source platform;
- collection method;
- observed timestamp;
- synthetic/manual/live flag;
- raw source reference where appropriate.

## Consequences

The UI and documentation must clearly distinguish demo fixtures from real observations.
