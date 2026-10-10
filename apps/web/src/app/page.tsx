import Link from "next/link";
import { CaseStudy } from "@/components/case/CaseStudy";
import styles from "./home.module.css";

export default function Home() {
  return (
    <>
      <section className={styles.hero}>
        <div className={`wrap ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <span className="eyebrow">Extension · agent · MCP · Solana</span>
            <h1 className={`display ${styles.headline}`}>You pay <span className={styles.three}>3</span> times for food.</h1>
            <p className={styles.lede}>
              The food, the fees, and the difference to the cheapest option. The UPAY3FOOD extension shows all three on iFood, compares
              the menu per litre and per gram, outlines the item worth buying and takes you to it.
            </p>
            <p className="muted small">In Portuguese, “Você paga 3 vezes pela comida”: the name is the story.</p>
            <div className={styles.ctas}>
              <Link className="btn" href="/instalar">Install the extension</Link>
              <Link className="btn ghost" href="/agentes">Plug in your agent</Link>
            </div>
            <ul className={styles.trust}>
              <li>No login</li>
              <li>No private APIs</li>
              <li>Never orders or pays on its own</li>
            </ul>
          </div>
          <figure className={styles.heroShot}>
            <img src="/instalar/raio-x.png" width={380} height={666} alt="The extension popup on a real product: You pay 3 times and the Price X-ray" />
            <figcaption className="muted small">Real screen · 700 ml açaí bowl · São Paulo, 2026-10-10</figcaption>
          </figure>
        </div>
      </section>

      <section className="wrap" id="how-it-works">
        <div className={styles.head}>
          <h2 className={`display ${styles.h2}`}>How it works</h2>
          <Link href="/docs/04-product" className={styles.headLink}>Everything it does →</Link>
        </div>
        <ol className={styles.how}>
          <li>
            <img src="/instalar/tamanho.png" width={380} height={313} alt="The size worth buying, on a real menu" loading="lazy" />
            <strong>1 · Reads the shop’s menu</strong>
            <span className="muted">No login, no private API: only what is on your screen. Ranks per litre, per 100 g of meat, and drinks by kind.</span>
          </li>
          <li>
            <img src="/instalar/destaque.png" width={500} height={320} alt="The best item outlined on the menu" loading="lazy" />
            <strong>2 · Outlines what is worth it</strong>
            <span className="muted">Outlines, on iFood itself, the best item per litre and the one the agent picked for your request.</span>
          </li>
          <li>
            <img src="/instalar/sacola.png" width={380} height={572} alt="A bag read from the page" loading="lazy" />
            <strong>3 · Checks the bag</strong>
            <span className="muted">Food, fees and the difference read from the page and checked against the total. Nothing is clicked for you.</span>
          </li>
        </ol>
      </section>

      <section className="wrap">
        <div className={styles.bands}>
          <Link href="/agentes" className={`${styles.band} ${styles.bandAgents}`}>
            <span className="eyebrow">For agents · MCP</span>
            <strong className="display">Your Claude or ChatGPT, with the real price of delivery.</strong>
            <code className="num">upay3food.com/api/mcp</code>
          </Link>
          <Link href="/transparencia" className={`${styles.band} ${styles.bandTransp}`}>
            <span className="eyebrow">Transparency · Solana</span>
            <strong className="display">The calculation rules, anchored on mainnet.</strong>
            <span className="small">A hash of the methodology and the code that anyone can verify.</span>
          </Link>
        </div>
      </section>

      <CaseStudy />

      <section className="wrap">
        <div className={`night ${styles.privacyBand}`}>
          <div>
            <span className="eyebrow">Private funding · Solana</span>
            <h2 className={`display ${styles.h2}`}>Your USDC, shielded before you pay.</h2>
            <p>USDC leaves the Cloak shielded pool, not your wallet. Pix itself is not private: what we hide is your wallet. Paying the order’s Pix with USDC switches on once a licensed partner is in place.</p>
          </div>
          <div className={styles.privacyCtas}>
            <Link className="btn light" href="/wallet">Connect wallet</Link>
            <Link className="btn ghost" style={{ color: "var(--night-ink)", boxShadow: "inset 0 0 0 1.5px var(--night-ink)" }} href="/privacy">What stays private</Link>
          </div>
        </div>
      </section>

    </>
  );
}
