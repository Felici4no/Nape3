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
            <span className="eyebrow">Extensão · agente · MCP · Solana</span>
            <h1 className={`display ${styles.headline}`}>Você paga <span className={styles.three}>3</span> vezes pela comida.</h1>
            <p className={styles.lede}>
              A comida, as taxas e a diferença para a opção mais barata. A extensão UPAY3FOOD mostra as três no iFood, compara o cardápio
              por litro e por grama, marca o item que compensa e te leva até ele.
            </p>
            <p className="muted small">You pay three times for food: the food, the fees, and the difference.</p>
            <div className={styles.ctas}>
              <Link className="btn" href="/instalar">Instalar a extensão</Link>
              <Link className="btn ghost" href="/agentes">Plugue o seu agente</Link>
            </div>
          </div>
          <figure className={styles.heroShot}>
            <img src="/instalar/raio-x.png" width={380} height={666} alt="Popup da extensão num produto real: Você paga 3 vezes e Raio-X do preço" />
            <figcaption className="muted small">Tela real · Marmitex de Açaí 700 ml · São Paulo, 10/10/2026</figcaption>
          </figure>
        </div>
      </section>

      <section className="wrap">
        <div className={styles.head}>
          <h2 className={`display ${styles.h2}`}>Como funciona</h2>
          <Link href="/docs/04-product" className={styles.headLink}>Produto →</Link>
        </div>
        <ol className={styles.how}>
          <li>
            <img src="/instalar/tamanho.png" width={380} height={313} alt="Tamanho que compensa num cardápio real" loading="lazy" />
            <strong>1 · Lê o cardápio da loja</strong>
            <span className="muted">Sem login, sem API privada: só o que está na sua tela. Ordena por litro, por 100 g de carne e bebidas por tipo.</span>
          </li>
          <li>
            <img src="/instalar/destaque.png" width={500} height={320} alt="Destaque do melhor item no cardápio" loading="lazy" />
            <strong>2 · Marca o que compensa</strong>
            <span className="muted">Contorna no próprio iFood o melhor por litro e o item que o agente recomendou para o seu pedido.</span>
          </li>
          <li>
            <img src="/instalar/sacola.png" width={380} height={572} alt="Sacola lida da página" loading="lazy" />
            <strong>3 · Confere na sacola</strong>
            <span className="muted">Comida, taxas e diferença lidas da página e conferidas contra o total. Nada é clicado por você.</span>
          </li>
        </ol>
      </section>

      <section className="wrap">
        <div className={styles.bands}>
          <Link href="/agentes" className={`${styles.band} ${styles.bandAgents}`}>
            <span className="eyebrow">Para agentes · MCP</span>
            <strong className="display">Seu Claude ou ChatGPT com o preço real do delivery.</strong>
            <code className="num">upay3food.com/api/mcp</code>
          </Link>
          <Link href="/transparencia" className={`${styles.band} ${styles.bandTransp}`}>
            <span className="eyebrow">Transparência · Solana</span>
            <strong className="display">A regra do cálculo registrada na mainnet.</strong>
            <span className="small">Hash da metodologia e do código, verificável por qualquer pessoa.</span>
          </Link>
        </div>
      </section>

      <section className="wrap" id="market-now">
        <div className={styles.head}>
          <h2 className={`display ${styles.h2}`}>Painel do mercado</h2>
          <Link href="/market" className={styles.headLink}>Mercado completo →</Link>
        </div>
        <p className={`small ${styles.demoNote}`}>
          {source.mode === "demo"
            ? "Demonstração com dados fictícios: a rede de observações ainda não está publicada. Os números reais estão na extensão."
            : "Observações reais registradas pela extensão. Observações, não ofertas."}{" "}
          <SourceTag mode={source.mode} />
        </p>
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
        <div className={`night ${styles.privacyBand}`}>
          <div>
            <span className="eyebrow">Pagamento privado · Solana</span>
            <h2 className={`display ${styles.h2}`}>Seu USDC protegido antes de pagar.</h2>
            <p>O USDC sai do pool protegido da Cloak, não da sua carteira. O Pix em si não é privado: o que escondemos é a sua carteira. Pagar o Pix do pedido com USDC liga quando houver um parceiro licenciado.</p>
          </div>
          <div className={styles.privacyCtas}>
            <Link className="btn light" href="/wallet">Conectar carteira</Link>
            <Link className="btn ghost" style={{ color: "var(--night-ink)", boxShadow: "inset 0 0 0 1.5px var(--night-ink)" }} href="/privacy">O que fica privado</Link>
          </div>
        </div>
      </section>

      <div className="wrap">
        <p className="muted small">
          <Freshness minutes={acai.summary.freshness.newestAgeMinutes} count={quotes.reduce((n, q) => n + q.summary.sampleSize, 0)} /> em{" "}
          {quotes.length} mercados.
        </p>
      </div>
    </>
  );
}
