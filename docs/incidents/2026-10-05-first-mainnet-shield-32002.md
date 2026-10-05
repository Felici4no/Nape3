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

Use `/shield/diagnose` for this: it has no shield action, works on any
deployment URL (the blocking record is per-origin `localStorage`, so another
preview URL would not see it), and unlocks Cloak on demand with the
derivation message only.

## Update: the first simulation did not simulate the deposit

The read-only diagnosis showed no Cloak transaction (the shield did not
land), public USDC 6.062919, SOL 0.008265410, and an active, warmed-up
table `GLVcKLgw5rRsa6eWNXwNqMzP4tX8zXgfEMCx9837aan3` (8 addresses).

The simulation then simulated an ALT `CreateLookupTable + ExtendLookupTable`,
not the deposit. Cause, from the SDK source:

- `altAddresses` (plus the relay's `/health` tables) only replaces the
  *first* table (`acquireDepositAlt`). `planDirectV0Submission` then measures
  the deposit with those tables and, if the minimal set still exceeds 1232
  bytes, calls `createSupplementalAlt`, which (without `relaySupplementalAlt`)
  creates and extends a depositor-signed table. Simulate-only intercepted that
  transaction, simulated it and stopped the SDK: the deposit was never built.
- So the original attempt most likely created two tables (common, then
  supplemental): two identical SOL drops of 2,315,200 lamports
  (0.012895810 → 0.010580610 → 0.008265410).
- The relay path (`resolveRelaySupplementalAlt`) waits for
  `lastExtendedSlot < currentSlot`; the depositor path (`createEphemeralALT`)
  does not check the slot at all.

Fix: the simulation now passes every active table of the wallet, decodes each
simulated transaction from its bytes (program ids, referenced tables,
addresses an extension would add) and only reports WOULD_SUCCEED / WOULD_FAIL
for a transaction that invokes the Cloak program; otherwise
NOT_A_SHIELD_SIMULATION with the reason.

## Update: two wallet-funded ALTs; the deposit needs a new one every time

Chain: no Cloak transaction; two wallet-owned, warmed-up tables
`CTE1bHMrKbT29VRrYVCoF1gD4EYJaLrzBTMhwmWVPLc` (slot 453425017) and
`GLVcKLgw5rRsa6eWNXwNqMzP4tX8zXgfEMCx9837aan3` (slot 453425722), 2,315,200
lamports each. With both (plus the relay's prebuilt tables) the deposit still
exceeds 1232 bytes and the SDK asks for a third table whose addresses are
per-attempt (`9A14…`, `5WXQ…`, `7yJc…`: nullifier / nonce PDAs). Accumulating
wallet-funded tables cannot fix this.

### Option A: Transaction V1 (SIMD-0385), diagnostic first

`@cloak.dev/sdk` 0.2.5 already supports `transactionVersion: 1`: every account
static, no lookup tables, 4,096-byte packet, compute budget in the message
header (`V1_COMPUTE_CONFIG`). The SDK's own note: it "needs the cluster's v1
gate active and a signer that signs v1 messages (a browser wallet may not
yet)". Caveats found in the source:

- `acquireDepositAlt` runs before the version check, so v1 without
  `altAddresses` would still create (and then discard) a depositor-signed ALT.
  The diagnostic passes the existing tables to skip it.
- The v1 message still carries the ComputeBudget instructions in addition to
  the header config.

`/shield/diagnose` → "Simulate as Transaction V1" builds the same deposit
(same SDK instructions, proof, risk quote, accounts, payer, blockhash) as v1
and only simulates it (zero signature, sigVerify off). Verdicts: WOULD_SUCCEED
/ WOULD_FAIL (Cloak program ran), RPC_REJECTED (the RPC refused, e.g. v1 not
active), NOT_A_SHIELD_SIMULATION.

### Option B: `relaySupplementalAlt` (not enabled)

- Rent: the relay extends **its shared table** (`POST {relay}/supplemental-alt`);
  the user pays nothing for it. The table is shared and extended per deposit.
- Warm-up: `resolveRelaySupplementalAlt` waits for `lastExtendedSlot <
  currentSlot` (5 s timeout).
- Quote ordering: the risk quote is fetched first; the relay request starts
  right after the nonce is known, in parallel. The quote is never refreshed.
- Not simulation-safe: the relay call is an on-chain write by the relay even in
  our simulate-only mode (it is HTTP, not our `sendTransaction`).
- Failure falls back automatically to the depositor-signed ALT (user SOL). A
  production setup would need to refuse that fallback.

### Risk-quote ordering (likely cause of the original -32002)

Current path: risk quote → ALT #1 (wallet approval, confirm) → ALT #2
(approval, confirm) → deposit (approval) → preflight. The quote is never
refreshed, and the program has `RangeQuoteExpired` (0x10b0). Not proven
without the deposit's own logs, but it is the only hypothesis consistent with
"ALT warm, accounts present, deposit rejected".

### Reclaiming the two tables (not submitted)

Per table, signed by the wallet (authority): `DeactivateLookupTable`, then
after the deactivation slot leaves SlotHashes (~512 slots, ~3.5 min)
`CloseLookupTable` with recipient = wallet. `/shield/diagnose` shows the plan
and the lamports each table holds.

## Follow-up: SOL cost measurement and the Transaction V1 signing test

`/shield/diagnose` now does both of these. Neither one sends a transaction.

- **"Simulate as Transaction V1"** measures the SOL requirement around the same simulate-only run:
  1. The simulation is asked for the post-state of every writable account (`accounts`) and for the inner instructions (`innerInstructions: true`).
  2. The same accounts are read now with `getMultipleAccounts`.
  3. The fee for the exact compiled message comes from `getFeeForMessage`.
  4. The priority fee comes from the v1 header (`priorityFeeLamports`).
  5. The wallet's rent-exempt floor comes from `getMinimumBalanceForRentExemption(0)`.
  6. The System Program `createAccount`/`transfer` instructions are decoded with their lamports, and each target is marked new or existing.
  7. The panel reports the estimated total, a recommended minimum (total + rent-exempt floor + max(10%, 0.0005 SOL)) and whether the current balance covers it (`packages/pay/src/shield-cost.ts`).
- **"Transaction V1 signing test"** (`packages/pay/src/v1-signing-test.ts`):
  - Phantom is asked, with `signTransaction` only, to sign a 0-lamport transfer from the wallet to itself as a v1 message.
  - The signature is verified locally (ed25519 over the bytes built here, with the connected key), then discarded.
  - While the test runs, a guard makes the following throw: JSON-RPC send methods over fetch/XHR, relay submit URLs, and the provider's sign-and-send methods.
- **Finding:** `@solana/web3.js` 1.99 can *deserialize* a v1 transaction, but `MessageV1.serialize()` throws "Serialization of version 1 transaction messages is not supported". The Cloak SDK's `signerFromWalletAdapter` calls `signed.serialize()` on the wallet's result. Depending on what Phantom returns, that path can fail in the page even when Phantom signs correctly. The test therefore reports two things separately:
  - `sdkAdapterPathWorks`;
  - a fallback over raw bytes (`provider.request({ method: "signTransaction" })`), used only when the failure happened in the page before the wallet saw the transaction.

  The simulate-only run uses a zero-signature kit signer, so it never reaches this path.

### Results of the first run, and the fixes for two diagnostic bugs

- **V1 shield simulation:** success. 1516 bytes, the Cloak and Token programs succeeded, 216,817 CU, `err: null`, nothing broadcast.
- **SOL cost not measured:** `getMultipleAccounts` received the 9 writable accounts in one call, and RPC Fast caps that call at 5 inputs ("Too many inputs provided; max 5"). The reads now go in batches of ≤ 5, sequential and read-only, merged back in the original order (duplicates included). `readAccountsBatched` in `rpc-capture.ts`.
- **Phantom result was not a valid verdict:** the fallback sent `base58(full wire transaction)` to `provider.request({ method: "signTransaction" })`. Phantom documents that the `message` parameter takes `bs58.encode(transaction.serializeMessage())`, so "Reached end of buffer unexpectedly" only showed that our encoding was wrong. The test now answers two questions separately:
  - **A. Can Phantom sign a V1 message?** Two routes are tried:
    - Wallet Standard `solana:signTransaction` with the serialized transaction bytes. This is the standard's own input, and the wallet's `supportedTransactionVersions` is reported too.
    - Only if that gives no answer: `provider.request` with `base58(message bytes)`.

    Responses are described by shape only and parsed generically. Outcomes:
    - `PHANTOM_V1_SIGNING_SUPPORTED`
    - `PHANTOM_V1_SIGNING_UNSUPPORTED`: the Wallet Standard route refused the transaction, or the error is an explicit version refusal.
    - `DIAGNOSTIC_REQUEST_INVALID`: parse failures on the undocumented-for-v1 route.
    - `INCONCLUSIVE_USER_REJECTED`
  - **B. Can the current Cloak/web3.js adapter consume the result?** Answered locally with no prompt. It cannot: web3.js 1.99 `serialize()` throws for v1.
- **Adapter design:** `walletStandardV1Signer` (`packages/pay/src/v1-wallet-signer.ts`).
  - Same shape as the SDK's adapter signer (`address` + `modifyAndSignTransactions`).
  - Passes the kit transaction bytes to Wallet Standard `solana:signTransaction` and decodes the wallet's signed bytes.
  - Refuses a changed message or a signature that does not verify.
  - No web3.js round trip, and no hand-rebuilt message.
  - Not wired into the production shield yet.
