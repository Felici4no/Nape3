import type { Metadata } from "next";
import { SyntheticTag } from "@/components/bits";
import { InstrumentCard } from "@/components/InstrumentCard";
import { MarketRows } from "@/components/MarketRows";
import { CHANGE_LAG_MINUTES, FRESH_MINUTES, quoteAll, REGION, USDC_RATE } from "@/lib/market";
import styles from "./market.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Market" };

export default function MarketPage() {
  const quotes = quoteAll(new Date());
  return (
    <div className="wrap">
      <header className={styles.header}>
        <span className="eyebrow">Market overview · {REGION.label} · <SyntheticTag /></span>
        <h1 className={`display ${styles.h1}`}>Market</h1>
        <p className={styles.lede}>Every food is a normalized instrument: the same product, comparable across platforms, priced by full checkout total.</p>
      </header>

      <div className={styles.board}>
        <MarketRows quotes={quotes} />
      </div>

      <div className={styles.grid}>
        {quotes.map((q) => (
          <InstrumentCard key={q.instrument.slug} quote={q} size="m" />
        ))}
      </div>

      <section className={styles.method}>
        <h2 className="display">How a price gets on this board</h2>
        <ol>
          <li><strong>Observed, not quoted.</strong> A price is a checkout someone saw in their own session: subtotal + delivery + service − discount, reconciled to the displayed total.</li>
          <li><strong>Normalized.</strong> Titles are mapped to a comparable product: açaí by volume, pizza by size, sushi by pieces, burger as a single burger without sides. Combos, slices and temaki are excluded.</li>
          <li><strong>Fresh.</strong> Only observations from the last {FRESH_MINUTES / 60} h count. Fewer than 3 → “Not enough fresh market data”, never a guess.</li>
          <li><strong>Movement.</strong> The 24 h change compares medians now and {CHANGE_LAG_MINUTES / 60} h ago, and only when both windows have at least 3 observations.</li>
          <li><strong>USDC.</strong> Estimates use a {USDC_RATE.label}; no licensed off-ramp is integrated yet.</li>
          <li><strong>Provenance.</strong> Synthetic fixtures are labelled everywhere they appear. Prices from other accounts are market references, not offers you can execute.</li>
        </ol>
      </section>
    </div>
  );
}
