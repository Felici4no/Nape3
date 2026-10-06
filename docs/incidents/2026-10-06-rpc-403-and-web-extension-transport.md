# HTTP 403 on Solana RPC, and the site that could not reach the extension

Status: **fixed in code (`438cd25`, `a05b905`), pending confirmation in the browser.**

## Symptom

The browser showed `Solana error #8100002`. Decoded, it is
`SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR { statusCode: 403, headers, message: "" }`: an HTTP 403
on an RPC request, not an on-chain failure.

## Root cause (from the code)

Only `/shield` used the same-origin proxy (`/api/solana-rpc` → RPC Fast). These paths called
`https://api.mainnet-beta.solana.com` **directly from the browser**:
- `/wallet` (`WalletSession.check`);
- `/pay` (`createPaymentFlow`);
- the default `unlock()`.

The public endpoint answers browser requests with 403. Kit wraps that into #8100002.

This is inference from the code, not a reproduction. Vercel keeps runtime logs for 1 h on this plan,
so the original request is gone. It is the only call path that matches the symptom.

The proxy itself could also answer 403, for a disallowed origin or a method outside the allowlist.
The two were indistinguishable before.

## Fix

- `solanaRpc(stage)` is the only client RPC. On the deployed site it is the same-origin proxy, traced
  per request.
- The proxy tags every response `x-upay3food-rpc-layer: proxy` and every refusal
  `x-upay3food-rpc-reason`. Reasons: `origin-not-allowed`, `method-not-allowed`, `upstream-auth`,
  `upstream-rate-limited`, `upstream-timeout`, `upstream-unreachable`, `not-configured`.
- Kit keeps response headers in #8100002, so `classifyFailure()` can name the layer:

| Class | Meaning |
|---|---|
| `RPC_PROXY_ORIGIN_403` | our proxy refused the page's Origin |
| `RPC_PROXY_METHOD_403` | our proxy refused a JSON-RPC method |
| `VERCEL_PROTECTION_403` | 401/403 for the same-origin path without our marker (in front of the proxy) |
| `PUBLIC_RPC_403` | a public endpoint refused the browser |
| `RPC_UPSTREAM_AUTH_FAILURE` | RPC Fast rejected the proxy's credentials |
| `RPC_RATE_LIMIT` | 429 |
| `RPC_NETWORK_FAILURE` | no HTTP answer, upstream timeout/unreachable |
| `RPC_PROXY_NOT_CONFIGURED` | `RPC_FAST_URL` missing |
| `WALLET_PROVIDER_FAILURE` / `CLOAK_RELAY_FAILURE` | not the RPC at all |

- `GET /api/solana-rpc/health` runs `getHealth`, `getGenesisHash` and `getSlot` through the same
  forwarding path. It is read-only and returns fixed fields only.
- `/diagnostics` shows:
  - proxy, upstream and network;
  - a `getSlot` sent from the browser;
  - wallet detected and abbreviated address (silent reconnect, no prompt);
  - Cloak relay `/health`;
  - a live RPC trace (method, status, JSON-RPC code, time, class; never URLs, params or signed bytes).

Verified on the live site (2026-10-06): `upay3food.com/api/solana-rpc/health` answered proxy OK,
upstream (RPC Fast) OK, `mainnet-beta`, slot 453 756 901, 290 ms.

## Second finding: the site could not talk to the extension

- `externally_connectable` in the extension manifest listed only `localhost`/`127.0.0.1`. Chrome
  therefore gave `https://upay3food.com` no `chrome.runtime.sendMessage` to the extension at all.
- The background accepted only the origin of `settings.fundingAppUrl`, whose default was
  `http://localhost:3000/pay`.

Fix:
- the manifest and `TRUSTED_WEB_ORIGINS` list `https://upay3food.com`. No wildcard, no `docs.`, no
  previews; `www` redirects to the apex. A test keeps the two in sync.
- the default `fundingAppUrl` is `https://upay3food.com/pay`.
- `PING` / `GET_CONNECTIVITY` report each link: background up, iFood content script answering with
  its page context only, agent-api configured (origin only), executor registered, last poll.
- `pingExtension()` names the failing link: `NO_EXTENSION_ID`, `CHROME_RUNTIME_UNAVAILABLE`,
  `EXTENSION_NOT_FOUND`, `ORIGIN_REJECTED`, `TIMEOUT`.

## Still open

- `agent-api` is not deployed (no `AGENT_API_URL` on the project). The run loop
  web → agent → extension → iFood → agent → web cannot be proven outside localhost yet.
- Confirm in the browser that `/wallet` no longer produces #8100002 (`/diagnostics` RPC trace).
