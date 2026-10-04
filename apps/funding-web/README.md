# UPAY3FOOD Pay

The payment screen of UPAY3FOOD.agent. The extension popup's
**Pay R$X with crypto** opens it at a validated iFood checkout with Pix.

```
find cheapest valid purchase → detect Pix → connect wallet → privately fund → confirm → settle
```

| Agent state | Screen |
| --- | --- |
| `WALLET_REQUIRED` | Connect Phantom / Solflare (silent reconnect if already trusted) |
| `WALLET_CONNECTED` → `FUNDS_CHECKED` | One signature (not a transaction) unlocks the Cloak shielded balance; public USDC + SOL read from RPC |
| `SHIELD_REQUIRED` | **Shield required amount** (whole USDC, ≥ Cloak minimum), or "add USDC / SOL" |
| `PAYMENT_READY` | Confirmation: exact BRL total, estimated USDC funding, Cloak fee, destination type |
| `PAYMENT_AUTHORIZED` | Settlement disabled until a licensed off-ramp is integrated; nothing is spent |

Why a page and not the popup: browser wallets inject into web pages only,
never into extension pages. The page and the extension talk through
`externally_connectable`: the page fetches the checkout (incl. Pix payload)
by a one-time id, never through the URL, and reports back public data only
(address, balances, agent state). The extension checks the sender origin.

Security: wallet access only through the injected wallet. No seed phrase, no
private key, no keypair file (a test enforces it). Notes are encrypted in
localStorage with a key derived from the wallet signature.

```bash
pnpm dev:funding   # http://localhost:5174 (the extension's default "Pay page")
```

The flow logic is `src/flow.ts` (framework-free, unit-tested); `src/App.tsx`
only renders it.
