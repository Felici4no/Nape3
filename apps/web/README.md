# UPAY3FOOD.agent · Food Market (apps/web)

> Find the lowest valid way to complete the purchase.

A "stock market for food": observed delivery prices, normalized into
comparable products, an explainable agent, wallet funding and private payment.

| Route | What it shows |
| --- | --- |
| `/` | **THE FOOD MARKET IS MOVING.** Market rows, Market Now, Cheapest Near You, Biggest Price Drops, Your Watchlist, Agent Picks |
| `/market` | All instruments, methodology |
| `/market/[slug]` | Median / lowest / highest / spread, BRL + USDC, your checkout vs market (overpayment), observations, regional and account-context variation, *Find better option* / *Execute* |
| `/agent` | Natural-language intent → decision, ranked alternatives, rejections and reasoning |
| `/wallet` | Phantom/Solflare, abbreviated address, public USDC, private (Cloak) USDC, agent funding state |
| `/pay` | UPAY3FOOD Pay (`@nape3/pay`): Wallet → Private funds → Confirm |
| `/privacy` | What Cloak hides, what stays visible, from whom |

## Data

- **Synthetic demo data**, labelled on every page: `marketFixtures(now)` from
  `@nape3/fixtures` (fictitious merchants, timestamps relative to the request).
  No live data is invented.
- Every figure comes from the existing packages: `summarizeMarket`,
  `priceChange` (24 h movement only when both windows have ≥ 3 observations),
  `planPurchase` / `decide`, `compareCheckout`. See `src/lib/market.ts`.
- USDC values are estimates at the mock off-ramp rate (R$5,40 / USDC).

## Architecture

- website = market + agent + wallet UI. It renders without the extension.
- extension = observation + checkout context + Pix detection. Its popup opens
  `/pay` (`#pay=<id>&ext=<id>`); the checkout is fetched from the extension,
  never put in the URL.
- Wallet and Cloak code load only in the browser (`next/dynamic`, `ssr: false`).

## Run

```bash
pnpm dev:web     # http://localhost:3000
pnpm build:web
```
