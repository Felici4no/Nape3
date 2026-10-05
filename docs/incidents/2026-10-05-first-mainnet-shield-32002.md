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

## Final V1 result, and plan B (v0 + relay-paid supplemental lookup table)

**V1 result (2026-10-05):**
- The deposit simulates successfully: 1516 bytes, 206,317 CU, `err: null`.
- Measured wallet cost: 2,090,880 lamports.
  - Fees: 130,000 (10,000 base + 120,000 priority).
  - Rent for the 3 accounts the Cloak program creates: 1,960,880 (655,320 + 655,320 + 650,240).
- Recommended minimum balance: 3,241,120 lamports. The wallet holds 8,265,410, which is sufficient.
- **Phantom does not support Transaction V1.** Its Wallet Standard `solana:signTransaction` declares `supportedTransactionVersions = ["legacy", 0]`, and it refused the v1 bytes. The web3.js 1.99 adapter cannot serialize v1 either.
- The V1 code stays for future wallets and is not wired into the Phantom path.

### SDK code path for `relaySupplementalAlt` (@cloak.dev/sdk 0.2.5, dist/index.js)

`transact` → deposit → `submitTransactionDirect(…, relaySupplementalAlt, transactionVersion)`, in order:

1. `resolveAddressLookupTableAccounts`: the relay's `/health` tables (3 pre-built) plus `altAddresses`.
2. Risk quote:
   - `fetchRiskQuote(${relayUrl}/range-quote, …, context: "deposit")` returns an Ed25519-verify instruction and the deposit **nonce**.
   - `riskNoncePda = deriveRiskNoncePDA(nonce)`. The deposit instruction writes this account.
3. Prefetch, immediately after the quote: `getRelaySupplementalAlt()` → `requestRelaySupplementalAlt` → `POST ${relayUrl}/supplemental-alt { mint, nullifiers[2], bind0: nonce, depositor }`.
   - The relay creates or extends **its** shared table and returns `{ table }`.
   - `resolveRelaySupplementalAlt` then polls until the table contains the nullifier PDAs, `riskNoncePda(nonce)` and the depositor ATA, and until `lastExtendedSlot < currentSlot` (the warm-up gate; ≤ 5 s, 150 ms poll).
4. `planDirectV0Submission`: if the deposit exceeds 1232 bytes, `createSupplementalAlt` awaits the relay table. **On any relay failure it falls back to `createEphemeralALT`, a depositor-signed CreateLookupTable + ExtendLookupTable** (up to 3 creation attempts). `acquireDepositAlt` has the same fallback when no table is available at all.
5. `sendV0`: build the v0 message → `signTransaction` (the wallet) → `sendRawTransaction` (preflight on) → confirm.
   - It re-signs automatically on blockhash expiry (up to 2) and on transient transport errors (up to 3).
   - The tier loop (full → compact → minimal compute budget) re-signs on packet-size errors.

### Can the fallback be disabled cleanly?

Not through SDK options: `relaySupplementalAlt` is "opt-in, falls back automatically". It is disabled from outside, with no SDK patch, by three independent layers (`packages/pay/src/relay-shield-guard.ts`):

1. **Progress guard.** `RelayShieldGuard.onProgress` throws on the SDK's fallback announcements:
   - "falling back to a depositor-signed table"
   - "Creating address lookup table…"
   - "Waiting for wallet signature (lookup table)…"

   The throw happens inside the SDK's catch blocks, so the attempt ends before `createEphemeralALT` runs.
2. **Signer guard.** Every wallet signature goes through `guardedWalletSigner`, for the whole app and not only during a shield. A transaction that invokes the Address Lookup Table program is refused before the wallet is asked (`USER_FUNDED_ALT_BLOCKED`). During an attempt it also refuses:
   - anything but a v0 Cloak deposit (`UNEXPECTED_TRANSACTION`);
   - a second signature, which would be the SDK's automatic retry (`SECOND_SIGNATURE_BLOCKED`).
3. **Transport guard.** `rpc-capture` `inspectSend` never forwards, or simulates, a lookup-table transaction.

The SDK re-wraps errors (`classifyRelayError`), so the runtime rethrows the guard's own `RelayShieldAbort`. `ShieldOperation` handles it as follows:
- an abort before broadcast is non-blocking, and the attempt record is cleared;
- a second-signature refusal after a send stays blocking (outcome unknown).

### Risk-quote freshness: what is possible

The requested order (relay table → warm-up → **then** quote) **cannot work**:
- The relay table is bound to the quote's nonce (`bind0`).
- The table must contain `riskNoncePda(nonce)`, which the deposit instruction writes.
- A quote fetched after the table carries a new nonce the table does not cover, so the deposit would need another table.

The SDK already does the closest correct thing: it fetches the quote and requests the relay table immediately after it. The incident's fatal gap was two wallet-signed ALT creations and three approvals between the quote and the deposit. It is removed:
- **Nothing user-paced runs between the quote and the one deposit prompt.** No wallet-signed table, no second approval.
  - The viewing-key registration *message* (once per page load) and the Cloak unlock message both happen before the quote.
- **A freshness gate runs twice:**
  - *Before the wallet prompt:* quote age ≤ 30 s and, if the quote carries an expiry, ≥ 30 s left.
  - *After the wallet returns, before the SDK sends:* age ≤ 90 s and, if an expiry is known, ≥ 10 s left.

  A stale quote aborts with nothing broadcast (`RISK_QUOTE_STALE`). The user can start a new attempt, which brings a new quote and a new relay table at the relay's cost. These thresholds are provisional. The quote message layout is undocumented, so `inspectRangeQuote` reports every i64 field that looks like a timestamp, and the dry run measures the real lifetime before the thresholds are fixed.
- **Fallback if the measured lifetime is shorter than a human approval:** a minimal SDK patch in `submitTransactionDirect`. After `resolveRelaySupplementalAlt`, when the quote is older than a threshold, re-fetch the quote and re-request the relay table once, before building the message. That is the only place where a new nonce and its table can be produced together. Not implemented until the measurement says it is needed.

### Prompts and cost on plan B

- **Wallet prompts:**
  - the Cloak unlock message (once per page);
  - the viewing-key registration message (once per page load; the SDK caches it in memory);
  - **exactly one transaction**: the deposit.
- **Expected wallet SOL:** about 2,090,880 lamports. That is the 3 Cloak accounts' rent (1,960,880) plus fees: 10,000 base + 120,000 priority when the full compute-budget tier fits, 0 priority on the compact tier. The lookup table is the relay's cost.
- `SOL_RECOMMENDED_LAMPORTS` is now 3,500,000 (it was 10,000,000, more than the wallet holds).

### Actions

`/shield/diagnose` → "Plan B":
- **Dry run.** No relay call: `/supplemental-alt` is answered locally. The deposit is simulated and nothing is signed or sent.
- **First real relay lookup-table test.** Behind an explicit checkbox:
  - the relay table is requested for real (the relay writes and pays on chain);
  - the deposit with it is only simulated, through the zero-signature signer and the simulate-only transport.

`/shield` keeps its state machine. Its "Confirm and open wallet" button stays **disabled** (`REAL_SHIELD_ENABLED = false`) until the relay test passes and a real shield is approved.

### First real relay lookup-table test, and enabling the real shield

Relay test result (mainnet, deposit only simulated):
- `RELAY_ALT_DEPOSIT_WOULD_SUCCEED` using relay table `G4r37pdrkv69i9bZx8jYQyDUp98Uz6fMMX727Y2bwUaE`, created and paid by the relay. The deposit also referenced the relay's pre-built table `329p1x7i…`.
- The v0 deposit is 1192 bytes (limit 1232). Simulation: `err: null`, 209,317 CU, and the Cloak and Token programs succeeded.
- Guard: no violation, and exactly one wallet signature was requested. The final `-32099` is this app's own simulate-only stop, not a relay or deposit failure.
- Risk quote: a 146-byte deposit message with one timestamp field at offset 1, about 599 s after the fetch (the expiry). The relay table was usable 2.7 s after the quote, with 597 s left at the wallet prompt.
  - Freshness limits are now set from this measurement: before the prompt, age ≤ 60 s and ≥ 120 s left; before sending, age ≤ 300 s and ≥ 60 s left.
  - With a ~10-minute quote, quote expiry explains the original `-32002` only if the old two-ALT flow took close to 10 minutes. **The historical root cause stays undetermined.**
- Measured wallet cost is unchanged: 2,090,880 lamports (130,000 fees + 1,960,880 rent).

The real shield is enabled in a separate commit (`REAL_SHIELD_ENABLED = true` in `ShieldScreen.tsx`). It is the same relay path, with every guard on and two explicit refusals added:
- a wallet other than Phantom;
- an amount other than exactly 1 USDC.

The path is forced to v0. The confirmation shows:
- Shield 1.000000 USDC;
- ~0.00209 SOL;
- one Phantom transaction approval;
- relay pays the lookup table.

The final button reads "Broadcast real mainnet shield of 1.000000 USDC", and the text above it says it WILL broadcast a real mainnet transaction. The blocked intent from the first failure is handled exactly as before: it is never cleared except by "Check on chain".
