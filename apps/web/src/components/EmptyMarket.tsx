import type { InstrumentQuote } from "@/lib/market";
import { freshnessLabel } from "@/lib/format";
import type { MarketSource } from "@/lib/source";
import styles from "./EmptyMarket.module.css";

/** True when no instrument has a single fresh comparable observation. */
export function marketIsEmpty(quotes: readonly InstrumentQuote[]): boolean {
  return quotes.every((q) => q.observations.length === 0);
}

/**
 * Shown instead of the board when the live market has nothing fresh to quote.
 * It never falls back to fixtures: it says what is missing and how data gets in.
 */
export function EmptyMarket({ source, quotes }: { source: MarketSource; quotes: readonly InstrumentQuote[] }) {
  const stale = quotes.reduce((n, q) => n + q.stale.count, 0);
  const newestStale = quotes.map((q) => q.stale.newestAgeMinutes).filter((m): m is number => m !== null);
  const otherRegions = quotes.reduce((n, q) => n + q.otherRegions, 0);
  const title = source.status === "unavailable" ? "Live market unavailable." : "Not enough real data yet.";
  return (
    <div className={`paper ${styles.box}`} role="status">
      <span className="eyebrow">Live market · {source.observations.length} real observations in 7 days</span>
      <h2 className={`display ${styles.title}`}>{title}</h2>
      {source.status === "unavailable" ? (
        <p>The observer API could not be read ({source.error}). Synthetic data is not shown in its place.</p>
      ) : (
        <ul className={styles.facts}>
          <li>No fresh comparable checkout in the last 2 h for any instrument.</li>
          {stale > 0 && (
            <li>
              {stale} older comparable observation{stale === 1 ? "" : "s"} (latest {freshnessLabel(Math.min(...newestStale))}), too old to quote.
            </li>
          )}
          {otherRegions > 0 && <li>{otherRegions} fresh observation{otherRegions === 1 ? "" : "s"} in other regions, kept out of the headline.</li>}
        </ul>
      )}
      <p className="small muted">
        Prices enter the market when the UPAY3FOOD.agent extension records a reconciled checkout and uploads it to the observer API
        (popup → settings → network endpoint).
      </p>
    </div>
  );
}
