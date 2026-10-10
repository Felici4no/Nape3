import type { PageContext, PageMerchant } from "../shared/types";

/**
 * iFood restaurant pages live at /delivery/<city>/<slug>/<uuid>. That public
 * path is the restaurant's identity on the platform: it is used to key
 * observations, never the query string or hash (which can carry tokens).
 */
const PATH = /^\/delivery\/([a-z0-9-]+)\/([a-z0-9-]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

export function merchantFromUrl(url: string): Omit<PageMerchant, "name" | "via" | "seenAt"> | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const match = PATH.exec(pathname);
  if (!match) return null;
  const [, city, slug, id] = match as unknown as [string, string, string, string];
  return {
    platformId: id.toLowerCase(),
    city: city.toLowerCase(),
    slug: slug.toLowerCase(),
    path: `/delivery/${city.toLowerCase()}/${slug.toLowerCase()}/${id.toLowerCase()}`
  };
}

/** Contexts that belong to the restaurant the user just opened (product modal, bag, checkout, Pix). */
const CARRY: ReadonlySet<PageContext> = new Set(["PRODUCT", "CART", "CHECKOUT", "PIX_PAYMENT"]);
const TTL_MS = 2 * 60 * 60 * 1000;

const sameName = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }) === 0;

export interface MerchantMemory {
  /**
   * The restaurant this page belongs to: from the URL when it has one,
   * otherwise carried from the last restaurant page (same tab, at most 2 h),
   * unless the page names a different merchant.
   */
  resolve(url: string, context: PageContext, pageMerchantName: string | null, now?: Date): PageMerchant | undefined;
}

export function createMerchantMemory(): MerchantMemory {
  let last: PageMerchant | undefined;
  return {
    resolve(url, context, pageMerchantName, now = new Date()) {
      const fromUrl = merchantFromUrl(url);
      if (fromUrl) {
        const name = pageMerchantName ?? (last?.platformId === fromUrl.platformId ? last.name : null);
        last = { ...fromUrl, name, via: "url", seenAt: now.toISOString() };
        return last;
      }
      if (!last || !CARRY.has(context)) return undefined;
      if (now.getTime() - Date.parse(last.seenAt) > TTL_MS) return undefined;
      if (pageMerchantName && last.name && !sameName(pageMerchantName, last.name)) return undefined;
      return { ...last, via: "carried" };
    }
  };
}
