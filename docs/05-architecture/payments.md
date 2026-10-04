# Payments: Pix + Solana (prepared, not live)

## Pix detection (implemented, read-only)

`extractPixPayment` reads what the payment screen shows, in order of
preference:

1. visible **Pix Copia e Cola** payload → parsed as EMV BR Code, CRC16
   validated (`packages/payments/src/pix`), amount from tag 54;
2. **QR code** presence (image/canvas/svg hinted as QR);
3. visible **Pix key**.

Plus amount (payload or labelled value) and expiration ("Expira em 29:30").
No API interception, no network inspection, no token access.

## Route (interfaces + mocks)

```
wallet (USDC on Solana) → off-ramp (licensed partner) → Pix payout
```

- `solana/`: USDC mint constants, `WalletAdapter`, bigint base units,
  BRL→USDC conversion with integer rates (rounded up). `MockWallet`.
- `offramp/`: `OfframpProvider` (`quote`, `payoutToPix`). `MockOfframp`.
- `router/`: `PaymentRouter.plan()` lists steps and blockers (invalid CRC,
  dynamic code without amount, insufficient balance);
  `execute()` requires an explicit authorization for the exact amount and
  **refuses any non-simulated provider** in this MVP.

No token is created and no smart contract is deployed (ADR-006). A real
integration needs a licensed off-ramp partner, KYC/AML handled by that
partner, and a security review before enabling real funds.
