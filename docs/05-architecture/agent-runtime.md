# Agent runtime

> The LLM may interpret intent. The deterministic agent controls money and execution.

Goal: one persistent run per purchase.

```
intent → search market → choose cheapest valid option → revalidate in the user's session
→ prepare checkout → detect Pix → check wallet → private funding → confirm → settle → verify order
```

Hackathon-first, but no shortcut that would make real-money execution unsafe:
real settlement stays disabled until a licensed off-ramp exists (every run is
`executionMode: "simulated"` today, and the runtime refuses `"real"` with a
simulated off-ramp).

## 1. Directory structure

```
packages/agent/src/run/        pure deterministic core (no HTTP, DB, Chrome, wallet, RPC, Cloak)
  types.ts                     AgentRun, RunState, CheckoutState, PaymentState, SpendingMandate
  events.ts                    RunEvent (append-only log entries)
  reduce.ts                    reduceRun(events) → AgentRun   (state is derived, never stored as truth)
  invariants.ts                quote / budget / freshness / authorization checks
  next.ts                      nextAction(run, now) → what should happen next
  mandate.ts                   SpendingMandate evaluation (designed, not enabled)
  protocol.ts                  AgentBrowserCommand / BrowserResult (shared with the extension)
  describe.ts                  human timeline lines ("Searching market…")
packages/chain/src/solana/
  provider.ts                  SolanaRpcProvider, RpcFastProvider, MockSolanaRpcProvider
  balances.ts                  public USDC + SOL of an address
  transactions.ts              broadcast a signed tx, verify a USDC transfer
apps/agent-api/                persistent runtime / orchestrator (Node http, SSE)
  src/orchestrator.ts          drives runs: reduce → nextAction → perform → append
  src/ports.ts                 MarketPort, FundingPort, SettlementPort (interfaces)
  src/adapters/                observer market source, mock off-ramp funding, chain settlement
  src/store/                   RunStore: memory + Postgres (Supabase-compatible)
  migrations/001_agent_runtime.sql
  src/app.ts, src/server.ts    HTTP routes, SSE, auth
apps/extension/src/executor/   browser executor (polls commands, returns results)
apps/web                       run timeline on /agent (proxy to agent-api, SSE)
```

`packages/agent/src/state-machine.ts` (the popup's session machine) stays for
the extension's current checkout flow; persistent runs use `run/`.

## 2. Data model

```ts
interface AgentRun {
  id: string;
  userId?: string;
  executorId: string;                  // the browser executor (extension install) bound at creation
  executionMode: "simulated" | "real";
  state: RunState;
  intent: PurchaseIntent;
  candidates: CandidateRef[];          // ranked market references (never executable)
  rejectedCandidates: Array<{ candidateId; reasons }>;
  selectedCandidate?: CandidateRef;
  validatedQuote?: ExecutorQuote;      // CartQuote re-read in the user's session
  checkout?: CheckoutState;            // checkout quote + Pix target
  payment?: PaymentState;              // wallet, funds, requirement, confirmation, authorization, signature
  pendingCommand?: AgentBrowserCommand;
  failure?: { code; reason };
  createdAt; updatedAt; version;       // version = last event seq
}
```

A `CandidateRef` carries the observation id, platform, merchant, observed
total and age: enough to revalidate, never enough to pay. Every value that
reaches payment comes from an `ExecutorQuote` (`CartQuote` + `capturedAt` +
`executorId`), produced by the bound browser executor.

Postgres tables (`migrations/001_agent_runtime.sql`):

| Table | Holds |
| --- | --- |
| `agent_runs` | id, user_id, executor_id, run_token_hash, execution_mode, intent, derived state/version (cache of the reducer) |
| `agent_events` | (run_id, seq) primary key, type, actor, payload jsonb, at — append-only (no UPDATE/DELETE grants) |
| `market_observations` | observations a run's search used (sanitized, observer id stripped) |
| `cart_quotes` | quotes returned by the executor (revalidation, checkout) with reconciliation result |
| `payment_attempts` | amount, gross USDC, wallet address, signature, settlement status/reference |
| `browser_executors` | executor id, secret hash, created/last seen |

Never stored: seed phrases, private keys, Cloak notes or viewing keys,
cookies, session tokens, addresses, Pix payloads (only a SHA-256 digest).

## 3. Event model

Append-only; `seq` is per run and gap-free (optimistic concurrency on append).
Each event has `actor`: `user | agent | browser | wallet | chain | system`.

| Event | Actor | Payload (summary) |
| --- | --- | --- |
| `INTENT_CREATED` | user | intent, executorId, executionMode |
| `MARKET_SEARCHED` | agent | ranked candidates, rejected count, source |
| `CANDIDATE_SELECTED` | agent | candidateId |
| `REVALIDATION_REQUESTED` | agent | command (REVALIDATE_CANDIDATE) |
| `REVALIDATION_STARTED` | browser | commandId (executor picked it up) |
| `QUOTE_VALIDATED` | browser | ExecutorQuote |
| `CANDIDATE_REJECTED` | agent/browser | candidateId, reasons |
| `CHECKOUT_REQUESTED` | agent | command (PREPARE_CHECKOUT / READ_CHECKOUT) |
| `CHECKOUT_READY` | browser | ExecutorQuote at checkout |
| `PIX_REQUESTED` | agent | command (READ_PIX) |
| `PIX_DETECTED` | browser | amountCents, evidence, expiresAt, payloadDigest |
| `WALLET_CONNECTED` / `WALLET_DISCONNECTED` | wallet | address |
| `FUNDS_CHECKED` | wallet/chain | balances (decimal strings), requirement, verified flags |
| `SHIELD_REQUIRED` | agent | assessment |
| `PAYMENT_READY` | agent | assessment |
| `CONFIRMATION_REQUESTED` | agent | exact amount, gross USDC, wallet, digest, expiry |
| `USER_CONFIRMED` / `USER_REJECTED` | user | echo of the digest + amount |
| `PAYMENT_AUTHORIZED` | agent | amount, basis (`user-confirmation`; `mandate` reserved) |
| `PAYMENT_SUBMITTED` | wallet | signature |
| `SETTLEMENT_VERIFIED` / `SETTLEMENT_FAILED` | chain | signature, reference / reason |
| `ORDER_REQUESTED` | agent | command (VERIFY_ORDER) |
| `ORDER_CONFIRMED` | browser | order evidence |
| `RUN_FAILED` | agent | code, reason |

`reduceRun(events)` folds the log into an `AgentRun`. An event the reducer
rejects is never appended: the orchestrator validates by reducing
`[...events, candidate]` first.

## 4. State transitions

```
INTENT_CAPTURED ─MARKET_SEARCHED→ CANDIDATES_NORMALIZED            (0 valid → NO_VALID_OPTION)
CANDIDATES_NORMALIZED ─CANDIDATE_SELECTED→ BEST_OPTION_SELECTED
BEST_OPTION_SELECTED ─REVALIDATION_REQUESTED→ REVALIDATION_REQUESTED ─REVALIDATION_STARTED→ REVALIDATING
REVALIDATION_REQUESTED|REVALIDATING ─QUOTE_VALIDATED→ QUOTE_VALIDATED
REVALIDATION_REQUESTED|REVALIDATING ─CANDIDATE_REJECTED→ CANDIDATES_NORMALIZED (next) | NO_VALID_OPTION
QUOTE_VALIDATED ─CHECKOUT_REQUESTED→ (same) ─CHECKOUT_READY→ CHECKOUT_PREPARED
CHECKOUT_PREPARED ─PIX_REQUESTED→ (same) ─PIX_DETECTED→ PIX_DETECTED
PIX_DETECTED → WALLET_REQUIRED | WALLET_CONNECTED         (depending on a known wallet)
WALLET_REQUIRED ─WALLET_CONNECTED→ WALLET_CONNECTED
WALLET_CONNECTED|FUNDS_CHECKED|SHIELD_REQUIRED ─FUNDS_CHECKED→ FUNDS_CHECKED
FUNDS_CHECKED ─SHIELD_REQUIRED→ SHIELD_REQUIRED | ─PAYMENT_READY→ PAYMENT_READY
PAYMENT_READY ─CONFIRMATION_REQUESTED→ USER_CONFIRMATION
USER_CONFIRMATION ─USER_CONFIRMED→ (confirmation recorded) ─PAYMENT_AUTHORIZED→ PAYMENT_AUTHORIZED
USER_CONFIRMATION ─USER_REJECTED→ CANCELLED
PAYMENT_AUTHORIZED ─PAYMENT_SUBMITTED→ SETTLING ─SETTLEMENT_VERIFIED→ SETTLED | ─SETTLEMENT_FAILED→ SETTLEMENT_FAILED
SETTLED ─ORDER_REQUESTED→ (same) ─ORDER_CONFIRMED→ ORDER_CONFIRMED
any non-terminal ─RUN_FAILED→ FAILED
wallet change (different address) in FUNDS_CHECKED…USER_CONFIRMATION → QUOTE_VALIDATED
  (funds, Pix and confirmation cleared: checkout must be re-read and the user must confirm again)
WALLET_DISCONNECTED in the wallet path → WALLET_REQUIRED (after PAYMENT_AUTHORIZED: ignored, already signed)
```

Terminal: `ORDER_CONFIRMED`, `NO_VALID_OPTION`, `CANCELLED`, `SETTLEMENT_FAILED`, `FAILED`.

Future: `VALID_SPENDING_MANDATE → PAYMENT_AUTHORIZED` is the same
`PAYMENT_AUTHORIZED` event with `basis: { kind: "mandate", mandateId }`.
`evaluateMandate()` exists and is tested; the reducer refuses the mandate
basis until mandates are enabled.

### Invariants (enforced in the reducer, not the UI)

- A revalidated or checkout quote must reconcile (`verifyCartQuote`), match
  the intent's product and quantity, and come from the run's executor.
- Its total must be ≤ the intent's max budget, and ≤ the observed total + 10 %
  drift; otherwise the candidate is rejected and the next one is tried.
- Quotes older than 10 min cannot be authorized (stale); Pix targets past
  `expiresAt` cannot be authorized.
- Market observations never reach payment fields: the payment amount is the
  executor's checkout total, and the Pix amount must equal it.
- `PAYMENT_AUTHORIZED.amountCents` = confirmed amount = Pix amount = checkout total,
  and the wallet at authorization = the wallet that was confirmed and checked.
- A wallet change after funds were checked drops funds, Pix and confirmation.
- `executionMode: "real"` requires a non-simulated off-ramp (none exists).

## 5. API contract (`apps/agent-api`, default :8788)

| Method | Path | Auth | Body / result |
| --- | --- | --- | --- |
| POST | `/agent/executors` | — | → `{ executorId, executorSecret }` (extension registers once) |
| GET | `/agent/executors/me/commands` | executor bearer | → pending commands for this executor |
| POST | `/agent/runs` | — | `{ request, executorId, userId? }` → `{ run, runToken }` |
| GET | `/agent/runs/:id` | run token | → `{ run, events, nextAction }` |
| GET | `/agent/runs/:id/events` | run token (`?token=`, EventSource has no headers) | SSE: `event: run-event`, `data: { event, run, message }`; resumes with `Last-Event-ID` |
| POST | `/agent/runs/:id/browser-result` | executor bearer | `BrowserResult` |
| POST | `/agent/runs/:id/wallet-state` | run token | `{ connected, address?, shieldedUsdc?, checkedAt? }` (public balances read server-side) |
| POST | `/agent/runs/:id/confirm` | run token | `{ digest, amountCents }` or `{ reject: true }` |
| POST | `/agent/runs/:id/payment` | run token | `{ signature }` after the wallet signed the private withdrawal |
| GET | `/agent/chain/balances?address=` | — | public USDC + SOL via RPC Fast (keeps the key server-side) |
| GET | `/healthz` | — | |

Tokens are random 32-byte values; only SHA-256 hashes are stored.

## 6. Browser command protocol

```ts
type AgentBrowserCommand =
  | { type: "REVALIDATE_CANDIDATE"; commandId; runId; candidate: { candidateId, source, merchantName, requirement, quantity, observedTotalCents } }
  | { type: "PREPARE_CHECKOUT"; commandId; runId }
  | { type: "READ_CHECKOUT"; commandId; runId }
  | { type: "READ_PIX"; commandId; runId; expectedAmountCents }
  | { type: "VERIFY_ORDER"; commandId; runId };

type BrowserResult =
  | { commandId; type: "QUOTE"; quote: CartQuote; capturedAt; pageRef }
  | { commandId; type: "PIX"; amountCents; evidence; expiresAt?; payloadDigest? }
  | { commandId; type: "ORDER"; confirmed: boolean; evidence }
  | { commandId; type: "UNAVAILABLE"; reason }       // item/merchant gone, closed, out of area
  | { commandId; type: "NEEDS_USER"; reason }        // user must log in / add the item; command stays pending
  | { commandId; type: "STARTED" }                   // executor picked the command up
  | { commandId; type: "ERROR"; reason };
```

The executor sends commercial data only (items, fees, totals, ETA, Pix amount
and a payload digest). No cookies, tokens, addresses or account identifiers.
It never clicks "place order" or pays: it observes, navigates, reads.

## 7. RPC Fast integration boundary

- `RpcFastProvider` runs only in `apps/agent-api` (server). Its endpoint and
  key come from `RPC_FAST_URL` (+ optional `RPC_FAST_API_KEY`, sent as a
  header) and never reach the extension or a public browser bundle.
- The backend reads chain state (balances, transaction status) and may
  broadcast **already-signed** transactions. It never holds a signing key.
- Wallet signing (shield, private withdrawal) stays client-side in
  `@nape3/pay` with Phantom/Solflare; Cloak operations stay in
  `@nape3/payments/cloak`. The agent sees only interfaces: a funding
  requirement, balances, a signature to verify.
- Shielded balances are reported by the client (the server has no viewing
  key). A wrong report cannot move money: the Cloak withdrawal itself fails.

## 8. Implementation order

1. `packages/agent/src/run` (pure core) + tests.
2. `packages/chain` (provider interface, RPC Fast, mock, balances, transfer verification) + tests.
3. `apps/agent-api`: store (memory + Postgres schema, tested on PGlite), orchestrator with ports and mocks, HTTP + SSE + tests for the full orchestration.
4. Extension browser executor (registration, polling, command handlers).
5. Web: start a run from `/agent` and show its live timeline (no redesign).
6. Docs, `pnpm check`, end-to-end run against a real agent-api.
