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

One market source per request (`src/lib/source.ts`), shared by `/`, `/market`,
`/market/[slug]`, `/agent`, `/wallet` and the API routes:

| Mode | When | What it contains |
| --- | --- | --- |
| **live** | default whenever `OBSERVER_API_URL` is set | real observations from `apps/observer-api` (`GET /v1/observations`, 7-day window); anything synthetic or invalid is dropped |
| **demo** | no observer configured (labelled fallback), `MARKET_DATA=demo`, or the dev switch | `marketFixtures(now)` only: fictitious merchants, labelled *Synthetic demo* everywhere |

- **Never mixed.** Live quotes use the `real-only` policy and demo quotes
  `synthetic-only`; `include-synthetic` is not used by the website.
- **No silent fallback.** If live is selected and the observer is unreachable
  or quiet, pages show an empty state ("Not enough real data yet" / "Live
  market unavailable") with stale counts and other-region counts, never fixtures.
- **Same freshness everywhere.** Quotes count observations from the last 2 h;
  the agent rejects anything older than that, so it never picks a price the
  board calls stale.
- Account-specific prices (coupon, first order, membership) are flagged
  (`account price`); the agent marks them `market-reference`, not executable.
- Every figure comes from the existing packages: `summarizeMarket`,
  `priceChange`, `planPurchase` / `decide`, `compareCheckout` (`src/lib/market.ts`).
- USDC values are estimates at the mock off-ramp rate (R$5,40 / USDC).

| Env | Meaning |
| --- | --- |
| `OBSERVER_API_URL` | observer API base URL, e.g. `http://127.0.0.1:8787` |
| `OBSERVER_READ_TOKEN` | bearer token if the observer sets one (server-side only; never sent to the browser) |
| `MARKET_DATA` | `live` or `demo` to pin the mode |
| `ALLOW_DEMO_TOGGLE=1` | enable the dev switch in a production build |
| `AGENT_API_URL` | agent runtime (server-side); enables "Execute with the agent" on `/agent` |
| `NEXT_PUBLIC_EXTENSION_ID` | optional; otherwise the extension id is remembered from its Pay link |

Dev switch: the banner link calls `/api/dev/data-mode?mode=demo|live|auto`
(cookie `u3_data`); it is disabled in production unless `ALLOW_DEMO_TOGGLE=1`.

### API

| Route | Returns |
| --- | --- |
| `GET /api/market` | source description + quotes for every instrument |
| `GET /api/market/[slug]` | source + one quote (summary, 24 h change, observations, stale / region / account-context facts) |
| `GET /api/agent?q=…`, `POST /api/agent {"q"}` | source + `PurchasePlan` from the same source |
| `POST /api/runs`, `GET /api/runs/[id]`, `GET /api/runs/[id]/events` (SSE), `POST /api/runs/[id]/{wallet-state,confirm,payment}` | server-side proxy to agent-api (run token in `x-run-token` / `?token=`) |

## Architecture

- website = market + agent + wallet UI. It renders without the extension.
- extension = observation + checkout context + Pix detection. Its popup opens
  `/pay` (`#pay=<id>&ext=<id>`); the checkout is fetched from the extension,
  never put in the URL.
- Wallet and Cloak code load only in the browser (`next/dynamic`, `ssr: false`).

## Run

```bash
pnpm dev:api                                     # observer on :8787
OBSERVER_API_URL=http://127.0.0.1:8787 pnpm dev:web  # live market on :3000
pnpm dev:web                                     # no observer → labelled demo
pnpm build:web
```
