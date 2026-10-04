# Demo script

What the demo proves, and what is simulated, must be said out loud.

## Setup

```bash
pnpm install && pnpm build:extension
```

Chrome → `chrome://extensions` → Developer mode → Load unpacked →
`apps/extension/dist`. In the popup's *Settings & privacy*, set a coarse
region and keep *Compare with synthetic fixtures (demo)* on.

## Flow

1. **Open iFood** in your own logged-in session and add one açaí 500 ml to the
   bag. (If the tab was open before installing, the popup offers *Reload iFood tab*.)
2. **Context**: the popup header shows `CART` / `CHECKOUT` with the detection
   signals in the tooltip; the on-page badge appears (Shadow DOM, bottom right).
3. **Extraction**: *Breakdown* shows subtotal, delivery fee, service fee,
   discount and total, each with a confidence and the DOM evidence (tooltip),
   plus whether the total reconciles.
4. **MarketObservation**: the checkout is recorded locally as
   `browser-extension / live / non-synthetic` (service-worker console shows a
   structured `observation.recorded` log).
5. **Comparison**: "Your checkout is R$X. Comparable observations range from … "
   — with *Includes synthetic fixture data* when fixtures are used, or
   *Not enough fresh market data*.
6. **Intent**: type `quero açaí até R$25` → *Find better option*.
7. **Recommendation**: best option, total, savings vs median and vs your
   checkout, confidence, freshness, the score formula and every rejection
   reason. Fixture/other-account options are labelled *market reference —
   verify in <platform>*; your current checkout is the only executable option.
8. **Pix + Solana**: on the Pix screen, the popup shows the detected Copia e
   Cola payload (CRC valid), amount and expiry. The payments package plans
   wallet → USDC → off-ramp → Pix **in simulation only**.

## Limits to state during the demo

- Extractors were developed against synthetic HTML modelled on iFood; real
  pages may need selector/label calibration.
- Rappi and 99Food data are synthetic fixtures.
- No payment is executed.
