import Link from "next/link";
import type { Decision } from "@nape3/agent";
import { brl } from "@/lib/format";
import styles from "./DecisionCard.module.css";

/** Compact rendering of an agent decision (the same object /agent shows in full). */
export function DecisionCard({ intent, decision, error, href }: { intent: string; decision: Decision | null; error?: string | null; href?: string }) {
  return (
    <article className={styles.card}>
      <p className={styles.intent}>“{intent}”</p>
      {error ? (
        <p className="warn">{error}</p>
      ) : !decision || decision.status !== "selected" ? (
        <p className={styles.none}>No valid option. Nothing recommended.</p>
      ) : (
        <>
          <div className={styles.pick}>
            <span className="num">{brl(decision.totalCents)}</span>
            <span>
              {decision.selected!.merchantName}
              <span className={styles.src}>{decision.selected!.source}</span>
            </span>
          </div>
          <ul className={styles.facts}>
            {decision.savings.vsMarketMedianCents !== null && (
              <li className={decision.savings.vsMarketMedianCents > 0 ? "cheaper" : ""}>
                <span className="num">{brl(decision.savings.vsMarketMedianCents)}</span> below median {brl(decision.marketMedianCents)}
              </li>
            )}
            <li>confidence <span className="num">{decision.confidence}</span> · observed {decision.freshness.selectedAgeMinutes} min ago</li>
            <li>{decision.alternatives.length} alternatives · {decision.rejected.length} rejected</li>
          </ul>
          <p className={styles.ref}>{decision.selected!.executability.executable ? "You can execute this checkout." : "Market reference: verify the price in your own account."}</p>
        </>
      )}
      {href && <Link className={styles.more} href={href}>Open in agent →</Link>}
    </article>
  );
}
