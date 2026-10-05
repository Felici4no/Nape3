# First mainnet shield failure: `-32002` (open)

Wallet `9qAezschd4e5t5yi9F5SAw41g43Vuj6iYMh7dpcKqkUi`, `/shield`, 1 USDC.
Unlock and viewing-key registration succeeded; the lookup-table transaction
landed (SOL 0.012895810 → ~0.010580610); the deposit did not; public USDC
unchanged (6.062919). The UI blocked a second attempt. No further transaction
has been sent.

## What the code proves

- **Not a relay failure.** A Cloak *deposit* is submitted by the wallet through
  our RPC (`submitTransactionDirect`), preflight at `confirmed`. `transact()`
  then wraps *any* submission error with `classifyRelayError(lastError.message)`,
  producing `RelayInternalError("Relay returned an error: …")`. A production
  `@solana/kit` preflight error passed through that function yields exactly the
  observed text (regression test `packages/pay/src/shield-diagnostics.test.ts`).
- **The explanation was discarded twice.** In production builds the
  `SolanaError` message is only `Solana error #-32002; Decode … '<base64>'`;
  the base64 carries the preflight `logs`, `accounts`, `unitsConsumed`
  (not `err`, which lives on `error.cause`). The SDK keeps only the message,
  and our `safeErrorMessage` replaced the base64 with `[base64]`.
- **The SDK's error classification cannot work in production builds:** it
  pattern-matches `0x10b0`, `blockhash not found`, … on messages that contain
  only codes.

## Hypotheses (status)

| Hypothesis | Status |
| --- | --- |
| ALT used before its addresses were usable (warm-up) | Unlikely, not disproven. The SDK waits for `confirmed` on the ALT tx, then polls the table at `confirmed` (kit default) and checks only "not deactivated", with no slot check. Preflight ran after a second Phantom approval (seconds = many slots later) at `confirmed`, so the extension slot was almost certainly past. A warm-up failure would be a transaction-level `InvalidAddressLookupTableIndex` with no program logs. Phantom's own pre-sign simulation, run right after the ALT confirmed, could have hit it. Decided by the logs. |
| Range sanctions quote expired (`0x10b0`) | Plausible. The Ed25519 risk quote is fetched *before* the ALT is created, so its age at send = ALT approval + confirmation + second approval. |
| Insufficient SOL / rent, stale blockhash, wrong account/mint/PDA, compute exhaustion, program error, v0/v1 incompatibility, RPC Fast behaviour | Open: each has a distinct `err`/log signature; the new diagnostics print it. |

## Changes

- Structured capture of `sendTransaction` / `simulateTransaction` RPC errors
  (`{code, message, data:{err, logs, unitsConsumed, replacementBlockhash, accounts}}`)
  at the transport, before the SDK re-wraps them; decoder for the encoded
  `@solana/errors` context; safe formatter (keeps logs, indexes, custom codes,
  public addresses; strips URLs and key parameters; never takes a signed
  transaction; never retries).
- `/shield` failure view: captured diagnostic, read-only chain diagnosis,
  simulate-only shield (same SDK path; `sendTransaction` becomes
  `simulateTransaction`, zero signature with `sigVerify: false`, existing ALT
  reused, notes in memory, intent untouched), local decoder for a pasted
  console line. `pnpm cloak decode '<line>'` does the same offline.

## Next step (no transaction)

Decode the console line of the failed attempt (`pnpm cloak decode` or the
panel) **or** run "Simulate shield (no transaction)". Do not press "Check on
chain" first: with public USDC unchanged it clears the attempt record.
