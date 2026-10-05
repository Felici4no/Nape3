# Proof · first confirmed Cloak shield on Solana mainnet

Status: **CONFIRMED**

On 2026-10-05, UPAY3FOOD.agent completed its first real browser-wallet Cloak shield on Solana mainnet. The application reported `SHIELDED` and credited **1.000000 USDC** to the private balance.

## Receipt

| Field | Value |
| --- | --- |
| Network | Solana `mainnet-beta` |
| Provider | RPC Fast through the same-origin server proxy |
| Operation | `cloak-shield` |
| Amount | **1.000000 USDC** |
| Wallet | Phantom |
| Wallet address | `9qAezschd4e5t5yi9F5SAw41g43Vuj6iYMh7dpcKqkUi` |
| Signature | `4xa8vKZLHQfZF6GzvK4SAqQwRrQUN9H7UBmT5cvnc6BKjiMdQ2RMJKnRVqgq7HtG4tAyUeFbcXjWXWfZ1v4asQfx` |
| Slot | `453687294` |
| Confirmed at | `2026-10-05T20:32:11.000Z` |
| Cloak program | `zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW` |
| SDK | `@cloak.dev/sdk` 0.2.5 |
| Transaction path | v0 + relay-funded supplemental ALT |
| Private balance after confirmation | **1.000000 USDC** |

Explorer: https://solscan.io/tx/4xa8vKZLHQfZF6GzvK4SAqQwRrQUN9H7UBmT5cvnc6BKjiMdQ2RMJKnRVqgq7HtG4tAyUeFbcXjWXWfZ1v4asQfx

## Execution path

```
Phantom
→ risk quote
→ relay-funded supplemental ALT
→ ALT warm-up
→ quote freshness checks
→ one transaction approval
→ v0 Cloak deposit
→ preflight + broadcast
→ confirmation
→ SHIELDED
```

The user-funded lookup-table fallback is blocked at three layers: SDK progress guard, wallet signer guard, and RPC transport guard.

## Cost measured before broadcast

- network fee: 130,000 lamports;
- rent for the 3 Cloak accounts: 1,960,880 lamports;
- estimated total wallet debit: 2,090,880 lamports;
- recommended minimum balance: 3,241,120 lamports.

These are preflight measurements, not a claim about the final post-transaction wallet balance.

## Privacy boundary

The shield transaction itself is public. Cloak protects the later relationship between that public deposit and a shielded withdrawal from the pool.

This proof does **not** claim that Pix is private, and it does **not** prove the full merchant settlement route. The licensed off-ramp / BRL / Pix leg remains disabled.

See [Privacy Week](../privacy-week.md) and [Payments architecture](../05-architecture/payments.md).

## Repository convention

Successful externally verifiable milestones live in `docs/08-proofs/`. Failed attempts and investigations live in `docs/incidents/`.
