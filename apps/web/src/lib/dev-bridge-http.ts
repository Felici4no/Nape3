import { bridgeEnabled, type BridgeEnv, type BridgeStore } from "./dev-bridge";
import { blobStore } from "./dev-bridge.server";

export const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** The bridge does not exist at all (404) unless both tokens are configured. */
export function bridge(env: BridgeEnv = process.env): BridgeStore | null {
  return bridgeEnabled(env) ? blobStore(env.BLOB_READ_WRITE_TOKEN!) : null;
}
