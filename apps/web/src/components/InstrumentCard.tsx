import Link from "next/link";
import type { InstrumentQuote } from "@/lib/market";
import { Change, Freshness, Price, RangeBar, SyntheticTag } from "./bits";
import { FoodArt } from "./FoodArt";
import { WatchButton } from "./watchlist";
import styles from "./InstrumentCard.module.css";

/** A food "instrument": normalized name, best observed price, range, freshness. */
export function InstrumentCard({ quote, size = "m" }: { quote: InstrumentQuote; size?: "xl" | "l" | "m" | "s" }) {
  const { instrument: i, summary: s } = quote;
  return (
    <Link href={`/market/${i.slug}`} className={`${styles.card} ${styles[size]} tone-${i.tone}`}>
      <div className={styles.top}>
        <span className={`${styles.ticker} num`}>{i.ticker}</span>
        <div className={styles.topRight}>
          <SyntheticTag show={s.containsSynthetic} />
          <WatchButton slug={i.slug} name={i.name} />
        </div>
      </div>
      <FoodArt kind={i.art} className={styles.art} />
      <div className={styles.body}>
        <h3 className={`display ${styles.name}`}>{i.name}</h3>
        <span className={styles.unit}>{i.unit}</span>
        {s.sufficient ? (
          <>
            <div className={styles.priceRow}>
              <div>
                <span className={styles.label}>best observed</span>
                <Price cents={s.lowestCents} usdc={quote.usdc.lowest} size={size === "xl" ? "xl" : size === "s" ? "m" : "l"} />
              </div>
              <Change change={quote.change} />
            </div>
            {size !== "s" && <RangeBar low={s.lowestCents} median={s.medianCents} high={s.highestCents} />}
          </>
        ) : (
          <p className={styles.insufficient}>
            Not enough fresh market data
            <span>{s.sampleSize} comparable observation{s.sampleSize === 1 ? "" : "s"} in the last 2 h · needs 3</span>
          </p>
        )}
        <Freshness minutes={s.freshness.newestAgeMinutes} count={s.sampleSize} />
      </div>
    </Link>
  );
}
