# Synthetic iFood-like DOM fixtures

These HTML files are **hand-written approximations** of iFood web pages, used
to test the context detector and extractors deterministically. They are not
captures of real iFood pages. Labels follow the pt-BR copy commonly shown by
iFood (Subtotal, Taxa de entrega, Taxa de serviço, Total, Pix Copia e Cola);
class names are deliberately random so the parser cannot rely on them.

Each fixture contains decoys (minimum order, other menu items, banners,
struck-through prices) placed *before* the real values to prove the parser
does not pick "the first R$ on the page".

Calibrate against real pages before trusting live extraction; see
`apps/extension/README.md`.

## Regression fixtures

- `checkout-stale-drawer.html` — checkout after a SPA transition where the
  bag drawer is still mounted off-screen with the previous cart state.
  Reconstructed from a reported symptom (expected R$27,79, observed R$21,88);
  not a capture of real iFood markup. Replace or complement it with a real
  capture (popup → debug → "Copy DOM capture") when available.
- `cart-real-screenshot-skol.html` — modelled on a user screenshot of a real
  iFood bag drawer (values, labels and row order are real; markup is an
  approximation). Expected: 1x, R$69,66 + R$1,99 + R$6,90 = R$78,55; the
  "Cupom · 3 cupons disponíveis" block is not a discount.
