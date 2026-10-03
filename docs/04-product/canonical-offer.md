# Canonical offer

The canonical offer is the central product primitive.

Different platforms may describe equivalent offers differently. Nape3 maps source data into a common representation.

## Draft model

```ts
interface CanonicalOffer {
  source: string
  sourceOfferId?: string

  merchant: {
    name: string
    sourceMerchantId?: string
  }

  product: {
    category: string
    name: string
    volumeMl?: number
    size?: string
    attributes: Record<string, unknown>
  }

  pricing: {
    itemPrice: number
    deliveryFee: number
    serviceFee: number
    discount: number
    effectivePrice: number
  }

  logistics: {
    etaMinutes?: number
  }

  observedAt: string

  normalization: {
    confidence: number
    method: string
  }
}
```

## Initial effective price

```
effectivePrice =
itemPrice
+ deliveryFee
+ serviceFee
- applicableDiscounts
```

This formula must evolve as real checkout behavior is observed.
