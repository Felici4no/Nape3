# Connectors

A connector converts source-specific information into a raw Nape3 offer.

## Interface direction

```ts
interface DeliveryConnector {
  source: string
  search(intent: StructuredIntent): Promise<RawOffer[]>
}
```

## Initial implementations

For the hackathon, use the least fragile legitimate source available.

Possible progression:

1. controlled fixture dataset;
2. manually imported real observations;
3. browser-assisted capture;
4. documented or partner APIs where available.

## Constraint

The product must not depend on invented APIs or undocumented assumptions.

Every connector must clearly label whether its data is:

- synthetic;
- manually observed;
- imported;
- live.
