import Link from "next/link";
import type { InstrumentQuote } from "@/lib/market";
import { brl } from "@/lib/format";
import { Change, Freshness } from "./bits";
import styles from "./MarketRows.module.css";

/** Terminal-style market table: one row per normalized food. */
export function MarketRows({ quotes, dense = false }: { quotes: InstrumentQuote[]; dense?: boolean }) {
  return (
    <div className={`${styles.table} ${dense ? styles.dense : ""}`} role="table" aria-label="Food market">
      <div className={`${styles.row} ${styles.head}`} role="row">
        <span role="columnheader">Food</span>
        <span role="columnheader">Best BRL</span>
        <span role="columnheader">≈ USDC</span>
        {!dense && <span role="columnheader" className={styles.hideS}>Low · Median · High</span>}
        <span role="columnheader">24h</span>
        <span role="columnheader" className={styles.hideS}>Freshness</span>
      </div>
      {quotes.map((q) => (
        <Link key={q.instrument.slug} href={`/market/${q.instrument.slug}`} className={styles.row} role="row">
          <span className={styles.food} role="cell">
            <span className={`${styles.swatch} tone-${q.instrument.tone}`} />
            <span>
              <strong>{q.instrument.name}</strong>
              <span className={`num ${styles.ticker}`}>{q.instrument.ticker}</span>
            </span>
          </span>
          {q.summary.sufficient ? (
            <>
              <span role="cell" className={`num ${styles.best}`}>{brl(q.summary.lowestCents)}</span>
              <span role="cell" className="num">{q.usdc.lowest}</span>
              {!dense && (
                <span role="cell" className={`num ${styles.hideS} ${styles.range}`}>
                  {brl(q.summary.lowestCents)} · {brl(q.summary.medianCents)} · {brl(q.summary.highestCents)}
                </span>
              )}
              <span role="cell"><Change change={q.change} compact /></span>
            </>
          ) : (
            <span role="cell" className={styles.thin}>Not enough fresh data ({q.summary.sampleSize}/3)</span>
          )}
          <span role="cell" className={styles.hideS}>
            <Freshness minutes={q.summary.freshness.newestAgeMinutes} count={q.summary.sampleSize} />
          </span>
        </Link>
      ))}
    </div>
  );
}
