# Agent: intent, decision, state machine

## Intent (`packages/agent/src/intent.ts`)

Deterministic pt-BR parser. `"quero um açaí 500ml até 25 reais"` →

```json
{
  "product": { "category": "acai", "volumeMl": 500, "quantity": 1 },
  "budget": { "maxCents": 2500, "currency": "BRL" },
  "preferences": { "priceWeight": 0.8, "etaWeight": 0.2 },
  "execution": { "requireConfirmation": true },
  "parsing": { "method": "deterministic", "missing": [], "notes": ["default weights…"] }
}
```

It never invents values: a target budget is only set when the user states one
("idealmente 20"); missing volume/budget are listed in `parsing.missing`.
An `IntentFallbackParser` interface exists for a future LLM fallback; it is
not used.

## Decision (`packages/agent/src/decision.ts`)

1. **Hard constraints** (reject with a reason): provenance policy; cart-level
   total required; category/volume/quantity comparability (a cart with an
   extra item is not comparable); normalization confidence; region; staleness
   (> 24 h); budget.
2. **Soft factors → confidence**: freshness decay after 60 min, provenance
   (synthetic ×0.5), cart reconciliation.
3. **Score** = `priceWeight × priceScore + etaWeight × etaScore`, both min-max
   normalized among accepted candidates. The formula is printed per candidate.

If the intent has no volume, the volume of the user's current cart is used
(and stated); otherwise the output warns that sizes are mixed.

Output: selected option, total, alternatives, rejected (with reasons),
savings vs median / current checkout, market median, reasoning lines,
confidence, freshness, `containsSynthetic`, and **executability**:

- `current-checkout` — the only executable option;
- `own-observation` — seen earlier in this browser; must be re-verified;
- `market-reference` — another account or a fixture; not executable.

## State machine (`packages/agent/src/state-machine.ts`)

```
IDLE → INTENT_CAPTURED → MARKET_SEARCH → CANDIDATES_NORMALIZED
     → CONSTRAINTS_APPLIED → BEST_OPTION_SELECTED → USER_CONFIRMATION
     → CHECKOUT_PREPARED → PAYMENT_TARGET_DETECTED → PAYMENT_AUTHORIZED → SETTLED
(any) → ERROR · (no candidates / no valid option) → NO_VALID_OPTION · RESET → IDLE
```

Guards: CHECKOUT_PREPARED requires `USER_CONFIRMED`; PAYMENT_AUTHORIZED
requires an authorization with `confirmedByUser: true` whose amount equals the
detected payment target and an unexpired target. Amount mismatches between
decision, checkout and payment target are recorded as warnings.
`planPurchase` runs automatically only up to `USER_CONFIRMATION`.
