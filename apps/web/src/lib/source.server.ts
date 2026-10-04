import { cookies } from "next/headers";
import { cache } from "react";
import { DATA_COOKIE, loadMarketSource, type MarketSource } from "./source";

/**
 * Request-bound market source: environment + the development switch cookie.
 * Cached per request, so the layout banner and the page read the same snapshot.
 */
export const getMarketSource = cache(async (): Promise<MarketSource> => {
  const jar = await cookies();
  return loadMarketSource({ env: process.env, cookie: jar.get(DATA_COOKIE)?.value, now: new Date() });
});
