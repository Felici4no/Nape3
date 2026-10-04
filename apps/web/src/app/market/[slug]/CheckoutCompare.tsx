"use client";

import Link from "next/link";
import { useState } from "react";
import { RangeBar } from "@/components/bits";
import { brl, usdcEstimate } from "@/lib/format";
import styles from "./product.module.css";

interface Summary {
  sufficient: boolean;
  sampleSize: number;
  lowestCents: number | null;
  medianCents: number | null;
  highestCents: number | null;
  containsSynthetic: boolean;
}

function parseBRLInput(text: string): number | null {
  const m = /^\s*(?:r\$\s*)?(\d{1,6})(?:[.,](\d{1,2}))?\s*$/i.exec(text);
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0")) : null;
}

/** "Your checkout" vs the market: overpayment in BRL and USDC, then act. */
export function CheckoutCompare({
  instrument,
  summary: s,
  initialCheckout
}: {
  instrument: { slug: string; name: string; intent: string };
  summary: Summary;
  initialCheckout: number | null;
}) {
  const [text, setText] = useState(initialCheckout ? (initialCheckout / 100).toFixed(2).replace(".", ",") : "");
  const checkout = parseBRLInput(text);
  const over = checkout !== null && s.lowestCents !== null ? checkout - s.lowestCents : null;
  const overMedian = checkout !== null && s.medianCents !== null ? checkout - s.medianCents : null;
  const budget = checkout !== null ? brl(checkout).replace(/\s/g, "") : null;
  const agentQuery = budget ? instrument.intent.replace(/até\s*R\$\s*[\d.,]+/i, `até ${budget}`) : instrument.intent;

  return (
    <section className={`night ${styles.compare}`}>
      <div className={styles.compareInput}>
        <label htmlFor="checkout" className={styles.label}>Your checkout for {instrument.name}</label>
        <input
          id="checkout"
          className="field"
          inputMode="decimal"
          placeholder="R$ 27,79"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <p className="small" style={{ color: "var(--night-ink-2)" }}>
          The extension fills this from your iFood checkout. Total including delivery, service fee and discounts.
        </p>
      </div>

      <div className={styles.compareOut}>
        <RangeBar low={s.lowestCents} median={s.medianCents} high={s.highestCents} marker={checkout} markerLabel="your checkout" />
        {checkout !== null && s.sufficient && over !== null && overMedian !== null ? (
          <div className={styles.verdict}>
            {over > 0 ? (
              <>
                <span className={`num ${styles.big} pricier`}>+{brl(over)}</span>
                <span>
                  above the lowest observed ({brl(s.lowestCents)}) · ≈ {usdcEstimate(over)}
                  <br />
                  {overMedian > 0 ? `${brl(overMedian)} above` : overMedian < 0 ? `${brl(-overMedian)} below` : "equal to"} the median
                </span>
              </>
            ) : (
              <>
                <span className={`num ${styles.big} cheaper`}>Lowest</span>
                <span>Your checkout is at or below every comparable observation ({s.sampleSize} fresh).</span>
              </>
            )}
          </div>
        ) : (
          <p style={{ color: "var(--night-ink-2)" }}>{s.sufficient ? "Enter your checkout total to see how it compares." : "Not enough fresh market data to compare."}</p>
        )}
        {s.containsSynthetic && <p className="small" style={{ color: "#f6d77a" }}>Compared against synthetic demo data.</p>}

        <div className={styles.actions}>
          <Link className="btn light" href={`/agent?q=${encodeURIComponent(agentQuery)}`}>Find better option</Link>
          {checkout !== null ? (
            <Link
              className="btn ghost"
              style={{ color: "var(--night-ink)", boxShadow: "inset 0 0 0 1.5px var(--night-ink)" }}
              href={`/pay#${new URLSearchParams({ amountCents: String(checkout), merchant: instrument.name })}`}
            >
              Execute {brl(checkout)}
            </Link>
          ) : (
            <button className="btn ghost" disabled style={{ color: "var(--night-ink)", boxShadow: "inset 0 0 0 1.5px var(--night-ink)" }}>
              Execute
            </button>
          )}
        </div>
        <p className="small" style={{ color: "var(--night-ink-2)" }}>
          Execute pays <em>your</em> checkout with privately funded crypto. Lower prices seen elsewhere are market references: the agent
          tells you where to look, you verify in your own account.
        </p>
      </div>
    </section>
  );
}
