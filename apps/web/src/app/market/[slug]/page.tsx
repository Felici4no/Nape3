import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Change, Freshness, Price, SourceTag } from "@/components/bits";
import { FoodArt } from "@/components/FoodArt";
import { WatchButton } from "@/components/watchlist";
import { brl, findInstrument, freshnessLabel, quoteInstrument, REGION } from "@/lib/market";
import { getMarketSource } from "@/lib/source.server";
import { CheckoutCompare } from "./CheckoutCompare";
import styles from "./product.module.css";

export const dynamic = "force-dynamic";

export function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return params.then(({ slug }) => ({ title: findInstrument(slug)?.name ?? "Market" }));
}

export default async function ProductPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { slug } = await params;
  const { checkout } = await searchParams;
  const instrument = findInstrument(slug);
  if (!instrument) notFound();
  const source = await getMarketSource();
  const now = new Date(source.fetchedAt);
  const quote = quoteInstrument(source.observations, instrument, now, source.mode);
  const s = quote.summary;
  const initialCheckout = checkout && /^\d{1,7}$/.test(checkout) ? Number(checkout) : null;

  return (
    <>
      <section className={`tone-${instrument.tone} ${styles.band}`}>
        <div className={`wrap ${styles.bandGrid}`}>
          <div>
            <Link href="/market" className={styles.crumb}>← Market</Link>
            <div className={styles.tags}>
              <span className="num">{instrument.ticker}</span>
              <SourceTag mode={source.mode} />
              <WatchButton slug={instrument.slug} name={instrument.name} />
            </div>
            <h1 className={`display ${styles.h1}`}>{instrument.name}</h1>
            <p className={styles.unit}>{instrument.unit} · {REGION.label}</p>
            {s.sufficient ? (
              <div className={styles.stack}>
                <div>
                  <span className={styles.label}>current market price (median)</span>
                  <Price cents={s.medianCents} usdc={quote.usdc.median} size="xl" />
                </div>
                <div className={styles.side}>
                  <Change change={quote.change} />
                  <Freshness minutes={s.freshness.newestAgeMinutes} count={s.sampleSize} />
                </div>
              </div>
            ) : (
              <p className={styles.thin}>
                Not enough fresh market data ({s.sampleSize} comparable observation{s.sampleSize === 1 ? "" : "s"} in the last 2 h, needs 3)
                {quote.stale.count > 0 && <>; {quote.stale.count} older, latest {freshnessLabel(quote.stale.newestAgeMinutes)}</>}
                {source.status === "unavailable" && <>; live market unavailable</>}.
              </p>
            )}
          </div>
          <FoodArt kind={instrument.art} className={styles.art} />
        </div>
      </section>

      <div className={`wrap ${styles.main}`}>
        <div className={styles.stats}>
          {[
            ["Lowest observed", s.lowestCents, quote.usdc.lowest],
            ["Median", s.medianCents, quote.usdc.median],
            ["Highest", s.highestCents, null],
            ["Spread", s.spreadCents, null]
          ].map(([label, cents, usdc]) => (
            <div key={label as string} className={styles.stat}>
              <span className={styles.label}>{label}</span>
              <Price cents={cents as number | null} usdc={usdc as string | null | undefined ?? undefined} size="m" />
            </div>
          ))}
        </div>

        <CheckoutCompare
          instrument={{ slug: instrument.slug, name: instrument.name, intent: instrument.intent }}
          summary={{ sufficient: s.sufficient, sampleSize: s.sampleSize, lowestCents: s.lowestCents, medianCents: s.medianCents, highestCents: s.highestCents, containsSynthetic: s.containsSynthetic }}
          initialCheckout={initialCheckout}
        />

        <section>
          <h2 className={`display ${styles.h2}`}>Observations</h2>
          {quote.observations.length === 0 ? (
            <p className="muted">No fresh comparable observations.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Checkout total</th><th>Merchant</th><th>Platform</th><th>Items</th><th>Seen</th><th>Promotion</th></tr>
                </thead>
                <tbody>
                  {quote.observations.map((o, i) => (
                    <tr key={o.id} className={i === 0 ? styles.best : ""}>
                      <td className="num">{brl(o.totalCents)}</td>
                      <td>{o.merchant}</td>
                      <td>{o.source}</td>
                      <td className="small">{o.title}</td>
                      <td className="small">{freshnessLabel(o.ageMinutes)}</td>
                      <td className="small">{o.promotion}{o.accountSpecific && <> · <span className="tag" title="Seen under an account-specific context; may not be available to your account">account price</span></>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {quote.lowestIsAccountSpecific && (
            <p className="warn small">
              The lowest total was observed with an account-specific promotion or membership. It is market intelligence, not an offer your account can execute.
            </p>
          )}
          <p className="muted small">{quote.excludedCount} other observations excluded (other products, sizes, regions, stale or item-only prices).</p>
        </section>

        <section className={styles.variation}>
          <div>
            <h3>By region</h3>
            {s.regionalVariation.map((g) => (
              <div className="kv" key={g.key}><span>{g.key}</span><span className="num">{brl(g.medianCents)} · n={g.sampleSize}</span></div>
            ))}
          </div>
          <div>
            <h3>By account context</h3>
            {s.accountContextVariation.map((g) => (
              <div className="kv" key={g.key}><span>{g.key}</span><span className="num">{brl(g.medianCents)} · n={g.sampleSize}</span></div>
            ))}
            <p className="muted small">Observed variation only; it does not say why prices differ.</p>
          </div>
        </section>
      </div>
    </>
  );
}
