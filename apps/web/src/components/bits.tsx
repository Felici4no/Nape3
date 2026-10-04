import type { PriceChange } from "@nape3/market";
import { brl, changeLabel, freshnessLabel } from "@/lib/format";
import styles from "./bits.module.css";

export function SyntheticTag({ show = true }: { show?: boolean }) {
  return show ? <span className="tag synthetic" title="Fixtures with fictitious merchants, not real observations">Synthetic demo</span> : null;
}

/** Which market the numbers come from: live observations or the synthetic demo. */
export function SourceTag({ mode }: { mode: "live" | "demo" }) {
  return mode === "demo" ? (
    <SyntheticTag />
  ) : (
    <span className="tag live" title="Real checkout observations from the UPAY3FOOD.agent extension, via the observer API">Live observations</span>
  );
}

/** BRL is the price; USDC is a secondary estimate. */
export function Price({ cents, usdc, size = "l" }: { cents: number | null; usdc?: string | null; size?: "xl" | "l" | "m" }) {
  return (
    <span className={`${styles.price} ${styles[size]}`}>
      <span className="num">{brl(cents)}</span>
      {usdc !== undefined && <span className={`num ${styles.usdc}`}>≈ {usdc ?? "—"}</span>}
    </span>
  );
}

/** Movement is rendered only when history supports it; otherwise it says so. */
export function Change({ change, compact = false }: { change: PriceChange | null; compact?: boolean }) {
  if (!change) {
    return <span className={`${styles.change} ${styles.flat}`} title="Not enough observations 24 h ago to compare">{compact ? "n/a" : "no history"}</span>;
  }
  const dir = change.changeCents < 0 ? "cheaper" : change.changeCents > 0 ? "pricier" : "flat";
  const arrow = dir === "cheaper" ? "▼" : dir === "pricier" ? "▲" : "■";
  return (
    <span
      className={`${styles.change} ${styles[dir]} num`}
      title={`Median now ${brl(change.currentMedianCents)} vs ${brl(change.previousMedianCents)} 24 h ago (${change.currentSampleSize} / ${change.previousSampleSize} observations)`}
    >
      {arrow} {changeLabel(change)}
      {!compact && <span className={styles.changeSub}> 24h</span>}
    </span>
  );
}

export function Freshness({ minutes, count }: { minutes: number | null; count: number }) {
  return (
    <span className={styles.fresh}>
      <span className={count > 0 ? styles.dotLive : styles.dotOff} />
      {count} obs · {freshnessLabel(minutes)}
    </span>
  );
}

/** Low / median / high with an optional marker (e.g. the user's checkout). */
export function RangeBar({
  low,
  median,
  high,
  marker,
  markerLabel = "you"
}: {
  low: number | null;
  median: number | null;
  high: number | null;
  marker?: number | null;
  markerLabel?: string;
}) {
  if (low === null || median === null || high === null) {
    return <div className={styles.rangeEmpty}>Not enough fresh market data</div>;
  }
  const lo = Math.min(low, marker ?? low);
  const hi = Math.max(high, marker ?? high);
  const pos = (v: number) => (hi === lo ? 50 : ((v - lo) / (hi - lo)) * 100);
  return (
    <div className={styles.range}>
      <div className={styles.track}>
        <span className={styles.band} style={{ left: `${pos(low)}%`, width: `${pos(high) - pos(low)}%` }} />
        <span className={styles.median} style={{ left: `${pos(median)}%` }} />
        {marker != null && (
          <span className={styles.marker} style={{ left: `${pos(marker)}%` }}>
            <span>{markerLabel}</span>
          </span>
        )}
      </div>
      <div className={`${styles.rangeLabels} num`}>
        <span>low {brl(low)}</span>
        <span>median {brl(median)}</span>
        <span>high {brl(high)}</span>
      </div>
    </div>
  );
}
