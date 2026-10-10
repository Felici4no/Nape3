import Link from "next/link";
import { CaseStudy } from "@/components/case/CaseStudy";
import styles from "./home.module.css";

export default function Home() {
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
            <ul className={styles.trust}>
              <li>Sem login</li>
              <li>Sem API privada</li>
              <li>Nunca faz pedido nem paga sozinha</li>
            </ul>
          </div>
          <figure className={styles.heroShot}>
            <img src="/instalar/raio-x.png" width={380} height={666} alt="Popup da extensão num produto real: Você paga 3 vezes e Raio-X do preço" />
            <figcaption className="muted small">Tela real · Marmitex de Açaí 700 ml · São Paulo, 10/10/2026</figcaption>
          </figure>
        </div>
      </section>

      <section className="wrap" id="como-funciona">
        <div className={styles.head}>
          <h2 className={`display ${styles.h2}`}>Como funciona</h2>
          <Link href="/docs/04-product" className={styles.headLink}>Tudo o que ela faz →</Link>
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

      <CaseStudy />

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

    </>
  );
}
