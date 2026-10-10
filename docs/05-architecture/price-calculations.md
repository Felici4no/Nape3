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

## Bebidas por litro (`liquidValue`)

- **Kinds:** açaí, refrigerante, suco, água, cerveja, chá, milk-shake,
  energético and café, from words in the title.
- **Comparison:** price per litre, only within the same kind.
- **Packs:** total volume = units × unit volume ("269ml com 15un",
  "6x350ml", "fardo 12"). For açaí, "2x" means toppings, so packs are never
  counted.
- **Bulk:** potes, baldes, caixas and anything ≥ 1,5 L stay out of cup
  comparisons ("Potes à parte") unless a bulk size is asked.

## Hambúrguer (`readBurger`, `comboPremiums`)

| View | Rule |
|---|---|
| gramas de carne | "180g" → 180; "2x 90g" → 180 (2 patties); "duplo 90g" → 180; nothing when the title has no grams |
| tipo de carne | bovino (blend, costela, picanha, smash, angus…), frango, suíno, vegetal, peixe, as named |
| por 100 g de carne | price × 100 ÷ meat grams, used by "Tamanho que compensa" on burger menus |
| o que o combo cobra | combo price − the standalone burger with the same base name and grams, on the same menu ("batata + refri custam R$12,00 a mais") |

## Pesquisa no cardápio (`adviseFromMenus`)

The agent answers an intent from the menus the user has already opened
(stored only in the extension, 24 h, at most 60 shops). Its answer is an
**estimate**, kept separate from the decision engine, which still ranks
real checkout totals only (ADR-004).

- **Estimated total:** item × quantity + the delivery fee shown on that
  shop's page + the service fee (R$0,99). Shops whose delivery fee was not
  read get no total.
- **Mais barato no tamanho pedido:** the requested volume ±10%, within the
  budget, lowest estimated total.
- **Melhor custo por litro / por 100 g de carne:** among all items read,
  flagged when its estimated total is over the budget.
- **Executable:** never. The answer links to the shop; the bag confirms the
  price.

## What is never claimed

- That a price is available to another account: coupons, Clube and address
  change it (ADR-005).
- That a difference has a cause, or that it is discrimination.
- A comparison against synthetic or stale data.
