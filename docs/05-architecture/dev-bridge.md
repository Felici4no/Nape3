# Extension Dev Bridge

A temporary observatory for development, so real iFood pages can be debugged remotely without
exporting files by hand. **Not product storage.**

```
iFood DOM (the user's own session)
  → content script: detection + extraction + sanitized calibration capture
  → background (Debug mode + bridge started)
  → HTTPS POST upay3food.com/api/dev/extension/session/:id/snapshot
  → private Vercel Blob (30 min)
  → GET /api/dev/extension/session/:id/latest   (and /dev/bridge#<id> in the browser)
```

## Rules (enforced by code)

| Rule | Where |
|---|---|
| Off unless `DEV_BRIDGE_TOKEN` (≥ 24 chars) and `BLOB_READ_WRITE_TOKEN` are set; `GET /api/dev/extension/status` says why, without values | `lib/dev-bridge.ts` `bridgeConfig` |
| Writes need `Authorization: Bearer <DEV_BRIDGE_TOKEN>`; the token is typed by the developer in the popup, never in code | `authorized` |
| Session ids are random (128 bits), unrelated to any account; reads are by session id (capability) | `newSessionId` |
| Logical TTL 30 min; expired objects deleted on every read and write; expired sessions refuse writes | `sweep`, `sessionAlive` |
| Second sanitization check: e-mail, CPF, CEP, phone, Pix payload, street address or auth material → **422, nothing stored**, only the rule name returned | `forbiddenContent` |
| Snapshots only; never `AgentRun`, events or market data | — |
| Blob objects are private (no public URL) | `lib/dev-bridge.server.ts` |
| Extension side: Debug mode required; at most one post every 3 s, only on a real change; never cookies, storage, headers, input values or the raw address | `content/devbridge.ts`, `content/capture.ts` |

## Snapshot (schema `upay3food.dev-snapshot.v1`)

`capturedAt`, `context`, `detection { context, confidence, signals }`, `extracted`
(restaurant/product/cart/Pix, scrubbed), `sanitizedStructure` (the calibration capture: header/nav/footer
as structure only, input values never, query values by shape), and
`diagnostics { extensionVersion, pageContext, navigationType, pageAgeSeconds, path }`.

## Use

1. Vercel project: a Blob store connected (`BLOB_READ_WRITE_TOKEN`) and `DEV_BRIDGE_TOKEN` (Sensitive,
   ≥ 24 chars, Production + Preview), then a redeploy.
2. Check `https://upay3food.com/api/dev/extension/status`: `"enabled": true`.
3. Extension popup → Debug → Dev bridge: URL `https://upay3food.com`, paste the token → **Start bridge
   session**. Accept the host permission.
4. Browse iFood. Watch `https://upay3food.com/dev/bridge#<session id>`. Share only the session id.

## Next

`SEARCH_RESULTS` extractor built from the first real snapshot → regression fixture →
`READ_SEARCH_RESULTS` executor command → the web shows how many real results are visible. Then deploy
`agent-api` for the full run loop.
