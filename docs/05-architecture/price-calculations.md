# Price calculations (methodology)

Every number UPAY3FOOD shows is computed by pure, tested functions in
`packages/domain/src/insights.ts`, in integer cents. This page is the public
methodology: what each number means, where its inputs come from, and when it
is an estimate. Publishing it is deliberate. In the 2026 "Taxômetro" ruling, a
fee comparison without objective criteria was held to be unfair competition
(see [data sources](../03-market/data-sources.md)).

## "Você paga 3 vezes" (`priceLayers`)

| Layer | Definition | Source |
|---|---|---|
| 1. Comida | items subtotal (bag) or item price (product page) | page |
| 2. Taxas | delivery fee + service fee | page; on a product page the delivery fee comes from the restaurant card, and the service fee is estimated at iFood's R$0,99 per order (since 2025-05-25) |
| 3. Diferença | total − cheapest **real, fresh, comparable** observation, never below 0 | observation network; synthetic data never counts |

- **Total:** the observed checkout total when the page shows one; otherwise
  food + fees − discount, flagged *estimativa*.
- **Taxas no total:** fees ÷ total, as a percentage with one decimal.
- If an observed total differs from the sum of its parts, the card says so.

## Raio-X do preço (`costInsights`)

| View | Formula | Notes |
|---|---|---|
| por 100 ml | price × 100 ÷ volume | volume parsed from the title ("700ml", "0,5 L", "meio litro") |
| o litro | price × 1000 ÷ volume | compares sizes |
| por 100 g | price × 100 ÷ weight | weight parsed from the title ("500g", "1,2 kg") |
| 100 ml com as taxas | (price + fees) × 100 ÷ volume | the real cost of 100 ml delivered |
| as taxas valem N ml | fees × volume ÷ price | the fees expressed in this product |
| por pessoa | (price + fees) ÷ servings | servings from "Serve N pessoa(s)" |
| desconto exibido | (struck − current) ÷ struck | the struck price is set by the shop and is shown as such |

The price is the product's own price, including any toppings it bundles
(e.g. "Açaí + 2x Amendoim 300ml"). Fees on a product page are estimates until
the bag confirms them.

## Tamanho que compensa (`menuValue`)

- **Inputs:** the açaí items on the restaurant page's menu cards (title +
  current price). Cards repeated in the "Destaques" carousel are counted once.
- **Ranking:** by price per 100 ml, cheapest first. Items without a size in
  ml are left out and counted.
- **Spread:** how much cheaper per 100 ml the best item is than the worst.
- Menu prices only, no fees. The same comparison between shops needs the
  checkout totals (layer 3).

## What is never claimed

- That a price is available to another account: coupons, Clube and address
  change it (ADR-005).
- That a difference has a cause, or that it is discrimination.
- A comparison against synthetic or stale data.
