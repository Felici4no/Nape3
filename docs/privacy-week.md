# Privacy Week · Cloak in UPAY3FOOD.agent

UPAY3FOOD.agent already finds the cheapest valid purchase (cart-level totals,
explainable decision). Cloak is its **private funding layer**: the USDC that
pays for that purchase leaves a shielded pool instead of the user's public
Solana wallet.

> Your purchase funding is shielded before settlement.

```
wallet ──shield──► Cloak USDC pool ──unshield (partialWithdraw)──► off-ramp ──Pix──► merchant
         visible        hidden: which note paid what          visible amount       not private
```

Code: `packages/payments/src/cloak` (SDK port, keys, notes, funding),
`packages/payments/src/router` (`FundingSource`), `apps/cloak-cli`,
`apps/funding-web`, popup panel in `apps/extension`.

## 1. What is hidden

- **The link between the user's wallet and the purchase.** The off-ramp
  deposit is a Cloak withdrawal from the shared pool; on-chain it does not
  come from the user's address.
- **Which deposit funded which payment**, and the shielded balance itself
  (notes and amounts inside the pool).
- The user's wallet history and balances are not exposed to whoever receives
  the payment.

**Not hidden** (shown in the UI as well):

- **Pix is not private.** The off-ramp, the PSP, iFood and the merchant see
  the Pix payment as usual. Cloak does nothing on the Pix side.
- The **shield** transaction (wallet → pool, amount, time) is public.
- The **unshield** transaction (pool → off-ramp, amount, time) is public.
- Cloak registers the user's viewing key with its relay for compliance
  screening. The relay operator can therefore view this wallet's shielded
  history. That is how Cloak is designed, and this integration leaves it
  enabled.

## 2. Hidden from whom

| Party | Sees wallet ↔ purchase link? |
| --- | --- |
| Public chain observers, analytics, other users | No |
| Off-ramp / Pix recipient | No: funds arrive from the pool (it still knows the Pix payment and, under KYC, the customer) |
| Merchant, iFood | Never saw the wallet; unchanged |
| Cloak relay (compliance, via the registered viewing key) | Yes, by design |
| Anyone holding the user's viewing key or note file | Yes, so these are never logged, uploaded or displayed |

Practical limit: if a user shields exactly R$27,79 worth of USDC seconds
before paying, amount and timing make the link easy to guess. The UI tells
users to shield in advance and in round amounts.

## 3. User benefit

Paying for food with crypto should not publish the payer's wallet to the
counterparty or to the public chain. Without the shielded pool, every
delivery order would become a public, permanent record tied to the wallet:
where and when the user eats, how often, and how much is left in the wallet.
Cloak keeps the agent's price advantage without that cost. The cost is shown
up front: the Cloak withdraw fee is 0.45 USDC + 0.3%, about 0.47 USDC on a
R$27,79 order.

## 4. Transaction proof

| | |
| --- | --- |
| Network | Solana mainnet-beta |
| Cloak program | `zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW` |
| SDK | `@cloak.dev/sdk` 0.2.5 |
| Flow | Shield (USDC deposit into the Cloak pool) |
| Signature | **PENDING: not executed yet** |
| Explorer | `https://solscan.io/tx/<signature>` |

The mainnet transaction must be signed by the project's own wallet. It cannot
be run from the CI or agent environment, which has no funds and no access to
the Cloak relay or mainnet RPC. To produce it (needs ≥ 1.00 USDC and a little
SOL for fees and lookup-table rent):

```bash
export SOLANA_RPC_URL="https://<mainnet rpc>"
export KEYPAIR_PATH="$HOME/.config/solana/id.json"   # keypair file; never an env private key
pnpm cloak shield 1          # asks for "yes"; prints the signature + explorer URL
pnpm cloak balance --reconcile
```

The signature is also appended to `~/.upay3food/cloak/proofs.jsonl`. Paste it
into the table above.

## 5. Two-minute demo script

| Time | Show | Say |
| --- | --- | --- |
| 0:00 | iFood checkout with 2× açaí, coupon applied | "UPAY3FOOD reads the checkout: R$27,79, reconciled field by field." |
| 0:20 | Popup → "Find better option" | "The agent ranks comparable offers by total price and explains every rejection. This checkout is the one you can actually pay." |
| 0:40 | Popup → Private funding panel | "Your purchase funding is shielded before settlement. Pix stays a normal Pix. What we hide is your wallet." |
| 0:55 | "Fund R$27,79 privately" → funding page, connect Phantom, sign once | "One signature derives the Cloak key. Notes are encrypted on this device." |
| 1:15 | Shielded balance, "Shield on mainnet" (or the CLI) | "USDC goes into the Cloak pool ahead of time. Here is the mainnet transaction on Solscan." |
| 1:35 | Purchase box: USDC needed + Cloak fee | "To pay, the off-ramp is funded from the pool, not from this wallet. The fee is shown before you confirm." |
| 1:50 | `pnpm demo:cloak` output (simulated route) | "The off-ramp is still simulated, so we don't fake the last step. The shield is real; the off-ramp leg is a mock until a licensed partner exists." |

## Engineering rules followed

- `@cloak.dev/sdk` only. Program id and relay are the SDK constants
  (`CLOAK_PROGRAM_ID`, `CLOAK_PRODUCTION_RELAY_URL`), never user input.
- All amounts are `bigint` base units. Fee math uses the SDK constants
  (`WITHDRAW_FIXED_FEE`, `WITHDRAW_FEE_BPS`, `MIN_DEPOSIT_SPL_BASE_UNITS`).
- Output notes are persisted and read back before any success is reported.
  Index and level-0 sibling are stored explicitly because `serializeUtxo`
  does not keep them. A persistence failure raises `CloakPersistenceError`
  with the signature, and the funds remain recoverable from chain with the
  viewing key.
- The logger is an allowlist: signatures, public amounts, counts. Keys,
  `nk`, seeds, notes and relay payloads cannot be logged; this is covered by
  tests.
- Real funding is blocked from paying a simulated off-ramp.
- Keys: the CLI uses a keypair file; the browser uses the wallet adapter
  with `signMessage`. In both, the Cloak key comes from the wallet's
  signature over a fixed message, so nothing secret is stored besides the
  notes (0600 file, or AES-GCM in the browser).

## Known limitations

- No licensed off-ramp is integrated, so funding a real Pix payment is
  disabled. Only shield, balance and unshield to an address you control
  (`pnpm cloak fund`) are real.
- Any site that gets the user to sign the same derivation message could
  derive the same Cloak key. The message says it authorizes nothing, but a
  wallet-native key derivation would be stronger.
- The Cloak docs site (`docs.cloak.ag/llms.txt`) was unreachable from the
  build environment. The integration follows the README and type
  declarations shipped inside `@cloak.dev/sdk` 0.2.5.
