# Nape3 · UPAY3FOOD.agent

> Users should know when better prices exist before committing to a purchase.

UPAY3FOOD.agent observes the prices and commercial conditions a user **already
sees** in their own delivery session (iFood first), compares their checkout
with recent comparable observations, understands a purchase intent ("quero
açaí 500ml até R$25") and prepares the best execution route — always with
explicit user confirmation.

Built for the Crypto World's Fair hackathon. No affiliation with iFood,
Rappi, 99Food, Colosseum, Superteam or any delivery platform.

## Status (honest)

| Area | State |
| --- | --- |
| Domain model (integer cents, CartQuote, provenance) | implemented, tested |
| Market aggregation (median, lowest, spread, freshness, variation) | implemented, tested |
| Intent parser (pt-BR, deterministic) + decision engine + state machine | implemented, tested |
| iFood context detection + extractors | implemented, tested on **synthetic** HTML; **not yet calibrated on real iFood pages** |
| Extension popup + on-page badge | implemented; smoke-tested in Chromium against the synthetic pages |
| Observation network API | local MVP (no auth, no anti-Sybil) |
| Rappi / 99Food | **fixtures only**: no live connector |
| Categories | açaí (volume), pizza (size), sushi (pieces), burger (single, loose) |
| Pix | BR Code parsing/validation of the visible payload; **no payment executed** |
| Solana (wallet → USDC → off-ramp → Pix) | interfaces + mocks; off-ramp still simulated |
| Private funding (Cloak, `@cloak.dev/sdk`) | **1.000000 USDC shield confirmed on Solana mainnet**; private balance credited. Proof: [2026-10-05 mainnet shield](docs/08-proofs/2026-10-05-mainnet-shield.md). Pix settlement remains disabled until a licensed off-ramp is integrated. |
| Agent runtime (`apps/agent-api`) | persistent runs over an append-only event log, orchestration, browser executor protocol, SSE, Postgres/Supabase schema; **simulated settlement only** (no licensed off-ramp). See [agent-runtime](docs/05-architecture/agent-runtime.md) |
| Food Market website (`apps/web`) | market, product pages, agent, wallet, pay, privacy; **live observations** from the observer API when configured, otherwise a labelled synthetic demo (never mixed) |
| Pay with crypto (popup → UPAY3FOOD Pay) | wallet status in popup, Phantom/Solflare connection, funds check, shield required amount, confirmation; **settlement disabled** (no licensed off-ramp) |

## Principles

- **Money is integer cents** (`Cents` branded type). Never floats.
- **Rank on the cart total** (`CartQuote.totalCents`), never on the item price.
- **Provenance is explicit**: `browser-extension` / `manual` / `fixture` / `partner-api`,
  with `live` and `synthetic` flags. Synthetic data is excluded unless opted in, and then flagged.
- **An observation from another account is market intelligence, not an executable
  offer.** Only the user's current checkout is executable.
- **Read-only on the page**: the extension never edits iFood's DOM; its UI lives in a closed Shadow DOM.
- **No credentials ever**: no cookies, tokens, passwords, addresses or account data are read, stored or sent.
- **Observational language**: "Your checkout is R$24,90. Comparable observations range from R$19,90 to R$25,40." — never claims of discriminatory pricing.

## Repository layout

```
apps/
  extension/      Chrome MV3: context detection, extractors, badge, popup
  observer-api/   observation network ingestion + aggregation (Node http)
  agent-api/      persistent agent runtime: runs, events, orchestration, SSE (Node http, Postgres/PGlite)
  cloak-cli/      private funding CLI: mainnet shield, balance, dry-run demo
  web/            Food Market (Next.js): market, product pages, agent, wallet, /pay, privacy
packages/
  domain/         money, CartQuote, MarketObservation, provenance, normalization
  market/         allowlist sanitizer, market summary, checkout comparison
  agent/          intent parser, decision engine, agent state machine
  fixtures/       deterministic synthetic açaí observations (iFood/Rappi/99Food)
  payments/       pix/ (BR Code), solana/, offramp/, router/, cloak/ (private funding)
  chain/          Solana RPC boundary: RPC Fast (server-side), mock, balances, transfer verification
  pay/            UPAY3FOOD Pay client: wallet (Phantom/Solflare), Cloak balance, payment flow
docs/             product, architecture, ADRs, hackathon
```

## Run

Requires Node ≥ 20 and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm check            # typecheck + tests + extension build
pnpm build:extension  # → apps/extension/dist (load unpacked in Chrome)
pnpm dev:api          # observation API on http://localhost:8787 (optional)
pnpm demo:agent       # agent runtime on :8788 with the simulated demo executor
pnpm demo:cloak       # private funding demo (simulated, no wallet)
OBSERVER_API_URL=http://127.0.0.1:8787 pnpm dev:web  # Food Market on :3000, live market (without it: labelled demo)
```

## Demo

See [docs/07-hackathon/demo.md](docs/07-hackathon/demo.md).

## Documentation

- [Overview](docs/00-overview/index.md) · [Problem](docs/01-problem/index.md) · [Product](docs/04-product/index.md)
- [Architecture](docs/05-architecture/index.md) · [Observation network](docs/05-architecture/observation-network.md) · [Agent](docs/05-architecture/agent.md) · [Payments](docs/05-architecture/payments.md)
- [Proofs](docs/08-proofs/index.md) · [First confirmed mainnet shield](docs/08-proofs/2026-10-05-mainnet-shield.md) · [Documentation index](docs/README.md)
- Decisions: [ADR-001](docs/decisions/ADR-001-delivery-first.md) · [ADR-002](docs/decisions/ADR-002-comparison-before-agency.md) · [ADR-003](docs/decisions/ADR-003-data-provenance.md) · [ADR-004](docs/decisions/ADR-004-rank-on-cart-total.md) · [ADR-005](docs/decisions/ADR-005-observation-is-not-an-offer.md) · [ADR-006](docs/decisions/ADR-006-payments-without-token.md)

## License

MIT — see [LICENSE](LICENSE).
