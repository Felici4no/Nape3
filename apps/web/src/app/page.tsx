import Link from "next/link";
import { Change, Freshness, Price, SourceTag } from "@/components/bits";
import { DecisionCard } from "@/components/DecisionCard";
import { EmptyMarket, marketIsEmpty } from "@/components/EmptyMarket";
import { FoodArt } from "@/components/FoodArt";
import { InstrumentCard } from "@/components/InstrumentCard";
import { MarketRows } from "@/components/MarketRows";
import { Watchlist } from "@/components/watchlist";
import { agentPicks, brl, freshnessLabel, quoteAll, REGION, USDC_RATE } from "@/lib/market";
import { getMarketSource } from "@/lib/source.server";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

export default async function Home() {
  const source = await getMarketSource();
  const now = new Date(source.fetchedAt);
  const quotes = quoteAll(source, now);
  const empty = marketIsEmpty(quotes);
  const [acai, burger, pizza, sushi, acai300] = quotes as [typeof quotes[number], typeof quotes[number], typeof quotes[number], typeof quotes[number], typeof quotes[number]];
  const picks = agentPicks(source, now);

  const cheapest = quotes
    .filter((q) => q.observations.length > 0)
    .map((q) => ({ q, best: q.observations[0]! }))
    .sort((a, b) => a.best.ageMinutes - b.best.ageMinutes);

  const drops = quotes
    .filter((q) => q.change && q.change.changeCents < 0)
    .sort((a, b) => a.change!.changeBps - b.change!.changeBps);
  const noHistory = quotes.filter((q) => q.summary.sufficient && !q.change);

  return (
    <>
      <section className={styles.hero}>
        <div className={`wrap ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <span className="eyebrow">Market now · {REGION.label} · <SourceTag mode={source.mode} /></span>
            <h1 className={`display ${styles.headline}`}>Você paga <span className={styles.three}>3</span> vezes pela comida.</h1>
            <p className={styles.lede}>
              A comida, as taxas e a diferença para a opção mais barata. A extensão UPAY3FOOD mostra as três no iFood, compara o cardápio
              por litro e te leva ao item que compensa. Depois, financia a compra com privacidade.
            </p>
            <p className="muted small">You pay three times for food: the food, the fees, and the difference.</p>
            <div className={styles.ctas}>
              <Link className="btn" href="/instalar">Instalar a extensão</Link>
              <Link className="btn ghost" href="/agentes">Plugue o seu agente</Link>
            </div>
          </div>
          <div className={styles.heroBoard}>
            {empty ? <EmptyMarket source={source} quotes={quotes} /> : <MarketRows quotes={[acai, burger, pizza, sushi]} dense />}
            <p className="muted small">
              Best = lowest fresh comparable checkout total (fees and discounts included). USDC at {USDC_RATE.label}. 24h movement
              only where history exists.
            </p>
          </div>
        </div>
      </section>

      <section className="wrap" id="market-now">
        <div className={styles.head}>
          <h2 className={`display ${styles.h2}`}>Market now</h2>
          <Link href="/market" className={styles.headLink}>Full market →</Link>
        </div>
        {!empty && <div className={styles.bento}>
          <div className={styles.b1}><InstrumentCard quote={acai} size="xl" /></div>
          <div className={styles.b2}><InstrumentCard quote={burger} size="l" /></div>
          <div className={styles.b3}><InstrumentCard quote={pizza} size="m" /></div>
          <div className={styles.b4}><InstrumentCard quote={sushi} size="m" /></div>
          <div className={styles.b5}><InstrumentCard quote={acai300} size="s" /></div>
        </div>}
        {empty && <MarketRows quotes={quotes} />}
      </section>

      <section className="wrap">
        <div className={styles.split}>
          <div>
            <div className={styles.head}>
              <h2 className={`display ${styles.h2}`}>Cheapest near you</h2>
              <span className="muted small">{REGION.label} · checkout totals</span>
            </div>
            {cheapest.length === 0 && <p className="muted">No fresh comparable checkouts near you yet.</p>}
            <ol className={styles.cheap}>
              {cheapest.map(({ q, best }) => (
                <li key={q.instrument.slug}>
                  <Link href={`/market/${q.instrument.slug}`}>
                    <FoodArt kind={q.instrument.art} className={styles.cheapArt} />
                    <span className={styles.cheapName}>
                      <strong>{q.instrument.name}</strong>
                      <span className="muted small">{best.merchant} · {best.source} · {freshnessLabel(best.ageMinutes)}</span>
                    </span>
                    <Price cents={best.totalCents} usdc={q.usdc.lowest} size="m" />
                    {best.accountSpecific && <span className="tag" title="Seen with an account-specific promotion or membership; may not be available to your account">account price</span>}
                  </Link>
                </li>
              ))}
            </ol>
          </div>
          <div className={`night ${styles.dropsPanel}`}>
            <div className={styles.head}>
              <h2 className={`display ${styles.h2}`}>Biggest price drops</h2>
              <span className="small" style={{ opacity: 0.7 }}>median vs 24 h ago</span>
            </div>
            {drops.length === 0 ? (
              <p>No drops with enough history to report.</p>
            ) : (
              <ul className={styles.drops}>
                {drops.map((q) => (
                  <li key={q.instrument.slug}>
                    <Link href={`/market/${q.instrument.slug}`}>
                      <span className={`display ${styles.dropName}`}>{q.instrument.name}</span>
                      <span className={styles.dropNums}>
                        <Change change={q.change} />
                        <span className="num small">{brl(q.change!.previousMedianCents)} → {brl(q.change!.currentMedianCents)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {noHistory.length > 0 && (
              <p className={styles.noHist}>
                No movement shown for {noHistory.map((q) => q.instrument.name).join(", ")}: not enough observations 24 h ago.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="wrap">
        <div className={styles.head}>
          <h2 className={`display ${styles.h2}`}>Your watchlist</h2>
        </div>
        <Watchlist quotes={quotes} />
      </section>

      <section className="wrap">
        <div className={styles.head}>
          <h2 className={`display ${styles.h2}`}>Agent picks</h2>
          <span className="muted small">Same decision engine as the extension: hard constraints first, then an explainable score.</span>
        </div>
        <div className={styles.picks}>
          {picks.map((p) => (
            <DecisionCard key={p.instrument.slug} intent={p.intent} decision={p.decision} error={p.error} href={`/agent?q=${encodeURIComponent(p.intent)}`} />
          ))}
        </div>
      </section>

      <section className="wrap">
        <div className={`night ${styles.privacyBand}`}>
          <div>
            <span className="eyebrow">Private payment</span>
            <h2 className={`display ${styles.h2}`}>Your purchase funding is shielded before settlement.</h2>
            <p>USDC leaves the Cloak shielded pool, not your wallet. Pix itself is not private: what we hide is your wallet.</p>
          </div>
          <div className={styles.privacyCtas}>
            <Link className="btn light" href="/wallet">Connect wallet</Link>
            <Link className="btn ghost" style={{ color: "var(--night-ink)", boxShadow: "inset 0 0 0 1.5px var(--night-ink)" }} href="/privacy">What stays private</Link>
          </div>
        </div>
      </section>

      <div className="wrap">
        <p className="muted small">
          <Freshness minutes={acai.summary.freshness.newestAgeMinutes} count={quotes.reduce((n, q) => n + q.summary.sampleSize, 0)} /> across{" "}
          {quotes.length} markets.
        </p>
      </div>
    </>
  );
}
