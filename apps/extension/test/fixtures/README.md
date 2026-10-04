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
