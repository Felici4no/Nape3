# Product

UPAY3FOOD is a browser extension (plus a website) that reads what iFood
already shows you and turns it into three numbers and a recommendation.
Install: https://upay3food.com/instalar

## Você paga 3 vezes

| Layer | Example (real bag, 2026-10-10) |
|---|---|
| 1. Comida | R$31,99 |
| 2. Taxas (delivery + service) | R$0,99 |
| 3. Diferença (above the cheapest real comparable observation) | shown once a comparison exists |

On a product page the total is an estimate until the bag confirms it
(delivery fee from the shop's card, service fee R$0,99).

![Bag read from the page](https://upay3food.com/instalar/sacola.png)

## Raio-X do preço

The same product seen as the market compares it: per 100 ml, per litre,
per 100 g, per person, the real 100 ml once fees are included, and the fees
expressed in the product itself ("as taxas valem 175 ml deste açaí").

## Tamanho que compensa

The shop's whole menu, ranked by price per 100 ml (açaí) or per 100 g of
meat (burgers), with potes kept apart and what each combo charges for its
extras ("batata + refri custam R$12,00 a mais").

![Tamanho que compensa on a real menu](https://upay3food.com/instalar/tamanho.png)

## Bebidas por litro

Every drink on the menu priced per litre, compared only within its kind
(refrigerante with refrigerante, cerveja with cerveja). Packs count every
unit: "Lata 269ml com 15un" = 4,035 L.

## Destaque no cardápio

On a restaurant page the extension outlines the best items right on iFood's
menu:

- **★ Melhor por litro** (green): the cup with the lowest price per litre.
- **Pote** (dashed): the best bulk option.
- **★ Melhor por 100 g de carne**: for burgers.
- **★ <tipo>: melhor por litro**: for each drink kind.
- **Recomendado · R$X estimado** (red): the agent's pick from the last
  search, for that shop.

"Ver no cardápio" in the popup scrolls to the item and pulses its outline.

The outlines are drawn on a layer of the extension's own (closed Shadow DOM,
mounted after the page settles), positioned over the cards. Nothing is
clicked and no iFood element is changed. The option can be turned off under
*Settings*.

## Pesquisa no cardápio

Ask "quero açaí 500ml até R$25". The agent answers from the menus you opened:

- the cheapest estimated checkout for the size you asked;
- if nothing fits, the closest size that does;
- the best price per litre;
- a link straight to the item on iFood.

Every number is an estimate to confirm in the bag. iFood shop pages can be
browsed without logging in, so a link can send anyone to the item.

The formulas are public: [price calculations](../05-architecture/price-calculations.md).

## What it never does

- read passwords, cookies, tokens or login data;
- click "Fazer pedido" or pay on its own;
- call private APIs or intercept iFood's network traffic;
- send your address, name, phone or CPF;
- run bots or dedicated accounts ([ADR-007](../decisions/ADR-007-no-headless-scraping.md)).

## Next

- **Other platforms:** Keeta, 99Food and Rappi with the same per-litre and
  three-layer views. The recommendation links to whichever platform is
  cheapest.
- **Mobile:** [plan](mobile.md).
