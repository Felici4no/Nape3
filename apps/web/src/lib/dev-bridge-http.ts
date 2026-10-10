import { bridgeEnabled, type BridgeEnv, type BridgeStore } from "./dev-bridge";
import { blobStore } from "./dev-bridge.server";

export const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex" };

/**
 * The extension calls the write routes from its service worker. When Chrome
 * withholds the host permission (site access "on click", or not yet granted),
 * the request is a CORS request with a preflight. Only extension origins are
 * allowed, without credentials: the bearer token is what authorizes a write.
 */
export function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  if (!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    vary: "origin"
  };
}

export function json(body: unknown, status = 200, request?: Request): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...(request ? cors(request) : {}) } });
}

export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: { ...NO_STORE, ...cors(request) } });
}

/** A store failure (e.g. Blob credentials) answers 502 with the error class, never a value. */
export function storeError(error: unknown, request: Request): Response {
  const name = error instanceof Error ? error.name : "Error";
  return json({ error: "storage unavailable", kind: name }, 502, request);
}

/** The bridge does not exist at all (404) unless both tokens are configured. */
export function bridge(env: BridgeEnv = process.env): BridgeStore | null {
  return bridgeEnabled(env) ? blobStore(env.BLOB_READ_WRITE_TOKEN?.trim() || undefined) : null;
}
