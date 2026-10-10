import { del, get, list, put } from "@vercel/blob";
import type { BridgeStore } from "./dev-bridge";

/**
 * Vercel Blob, private access: objects are readable only with the store's
 * credentials, never by URL. With no token, the SDK uses BLOB_STORE_ID and the
 * function's Vercel OIDC token.
 */
export function blobStore(token?: string): BridgeStore {
  return {
    async put(pathname, body) {
      await put(pathname, body, { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, token });
    },
    async list(prefix) {
      const out: Array<{ pathname: string; uploadedAt: Date; size: number }> = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, limit: 1000, token, ...(cursor ? { cursor } : {}) });
        out.push(...page.blobs.map((b) => ({ pathname: b.pathname, uploadedAt: new Date(b.uploadedAt), size: b.size })));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor && out.length < 5000);
      return out;
    },
    async get(pathname) {
      const result = await get(pathname, { access: "private", token, useCache: false });
      if (!result) return null;
      return new Response(result.stream).text();
    },
    async del(pathnames) {
      if (pathnames.length) await del(pathnames, { token });
    }
  };
}
