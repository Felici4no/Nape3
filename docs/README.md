# UPAY3FOOD documentation

> [!NOTE]
> **Você paga 3 vezes pela comida:** the food, the fees, and the difference to
> the cheapest option. UPAY3FOOD shows all three on iFood, compares the menu
> per litre, and takes you to the item that is worth it. It can then fund the
> purchase privately with USDC on Solana.

![Raio-X do preço on a real iFood product](https://upay3food.com/instalar/raio-x.png)

## Start here

| If you are… | Read |
|---|---|
| **A user** | [Install the extension](https://upay3food.com/instalar) · [What it shows](04-product/index.md) · [What it never does](04-product/index.md#what-it-never-does) |
| **A judge** | [Product](04-product/index.md) · [Price calculations](05-architecture/price-calculations.md) · [Mainnet proof](08-proofs/2026-10-05-mainnet-shield.md) · [Business model and pitch (pt-BR)](06-business/business-model-and-pitch.pt-BR.md) · [Benchmark](07-hackathon/benchmark.md) |
| **A developer** | [Architecture](05-architecture/index.md) · [Extension](apps/extension.md) · [Dev bridge](05-architecture/dev-bridge.md) · [Plug your agent (MCP)](05-architecture/agents.md) · [Data sources](03-market/data-sources.md) · [ADRs](decisions/ADR-001-delivery-first.md) |

## What works today (2026-10-10)

| Piece | Status |
|---|---|
| Reading iFood pages (search, restaurant, menu, product, bag, checkout, Pix) in the user's own session | **Real**, calibrated on live pages through the [dev bridge](05-architecture/dev-bridge.md) |
| "Você paga 3 vezes", Raio-X do preço, Tamanho que compensa, Bebidas por litro | **Real** numbers from the page; estimates are labelled |
| Pesquisa no cardápio (the agent answering from the menus already read) | **Estimate**: menu price + the shop's delivery fee + service fee; never an offer |
| Decision engine on checkout totals | **Real** totals only (ADR-004); comparisons need ≥ 2 real observations |
| Private funding: USDC shielded into Cloak | **Real on Solana mainnet** ([proof](08-proofs/2026-10-05-mainnet-shield.md)) |
| Off-ramp to Pix | **Disabled** until a licensed provider is integrated (ADR-006) |
| Website market board | **Synthetic demo data** until the observation network is deployed (the banner says so) |
| Your own agent (Claude, ChatGPT, Cursor) via MCP | **Live**: `https://upay3food.com/api/mcp`, [how](05-architecture/agents.md) |
| Mobile | [Plan](04-product/mobile.md) |

## How it works

```
your iFood session ──read only──► extension ──► normalize (ml, g of meat, pack units)
                                     │                     │
                                     │                     ├─► "Você paga 3 vezes" + Raio-X
                                     │                     ├─► Tamanho que compensa (menu per litre)
                                     │                     └─► Pesquisa no cardápio → link to the item
                                     └─► sanitized observation (no address, no account data)
                                                           └─► decision engine on real totals
USDC wallet ──shield──► Cloak pool ──(planned) licensed off-ramp──► Pix
```

## All sections

| Directory | Purpose |
| --- | --- |
| `00-overview/` | thesis and product boundary |
| `01-problem/` | fragmentation and substitutability |
| `02-user/` | user and jobs |
| `03-market/` | market, landscape and data sources |
| `04-product/` | what the product shows, normalization, mobile |
| `05-architecture/` | agent, calculations, observation network, payments, runtime |
| `06-business/` | business model and pitch |
| `07-hackathon/` | demo, submission, benchmark |
| `08-proofs/` | confirmed, externally verifiable milestones |
| `decisions/` | ADRs |
| `incidents/` | failures, investigations and postmortems |
| `spikes/` | time-boxed investigations before a design decision |

App READMEs (`apps/*/README.md`) are published with the docs under **Apps**.
Public documentation: https://docs.upay3food.com
