# Nape3 Browser Extension

Milestone 1 is intentionally narrow:

1. Open an iFood page.
2. Click the Nape3 extension.
3. Read visible product, merchant, and price information.
4. Click **Capture offer**.
5. Inspect the extension service-worker console for the structured `RawOffer`.

No backend persistence is implemented yet.

## Run locally

From the repository root:

```bash
pnpm install
pnpm dev:extension
```

For a loadable build:

```bash
pnpm build:extension
```

Then open Chromium/Chrome:

1. `chrome://extensions`
2. Enable **Developer mode**
3. Choose **Load unpacked**
4. Select `apps/extension/dist`

## Scope and data policy

The first version reads visible DOM content only. It does not access cookies, session tokens, checkout internals, or automate purchases.

## Known limitation

The first iFood extractor deliberately uses conservative generic DOM heuristics. Real pages must be inspected before introducing stable source-specific selectors.
