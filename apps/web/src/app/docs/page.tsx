import type { Metadata } from "next";
import Link from "next/link";
import styles from "./docs.module.css";

export const metadata: Metadata = {
  title: "Documentation",
  description: "UPAY3FOOD.agent product, architecture, privacy and on-chain proof."
};

const sections = [
  ["00–04", "Product model", "Overview, problem, user, market, normalization and canonical offers."],
  ["05", "Architecture", "Agent runtime, observation network, connectors and payments."],
  ["07", "Hackathon", "Demo script, submission material and scope boundaries."],
  ["08", "Proofs", "Confirmed, externally verifiable milestones kept separate from incidents."]
] as const;

export default function DocsHome() {
  return (
    <div className={styles.docs}>
      <div className={styles.hero}>
        <div>
          <span className="eyebrow">UPAY3FOOD · DOCUMENTATION</span>
          <h1 className="display">BUILD LOG, ARCHITECTURE, PROOF.</h1>
          <p className={styles.lede}>The public record for how UPAY3FOOD observes the food market, makes decisions and moves private funding.</p>
        </div>
        <div className={styles.status}>
          <span className="eyebrow">LATEST VERIFIED MILESTONE</span>
          <strong>1.000000 USDC SHIELDED</strong>
          <div>Solana mainnet · slot 453687294 · 2026-10-05</div>
          <div className={styles.actions}><Link className="btn light" href="/docs/proofs/2026-10-05-mainnet-shield">Open proof</Link></div>
        </div>
      </div>
      <div className={styles.grid}>
        {sections.map(([n,title,body]) => <div className={styles.card} key={n}><span className="eyebrow">{n}</span><h2>{title}</h2><p>{body}</p></div>)}
      </div>
      <section className={styles.section}>
        <span className="eyebrow">BOUNDARY</span><h2>What is real today</h2>
        <p>The Cloak shield is real on Solana mainnet. The licensed off-ramp → BRL → Pix merchant settlement remains disabled. Documentation keeps those two claims separate.</p>
        <div className={styles.actions}>
          <Link className="btn" href="/docs/proofs/2026-10-05-mainnet-shield">Mainnet shield proof</Link>
          <a className="btn ghost" href="https://github.com/Felici4no/Nape3-UPAY3FOOD/tree/claude/youthful-hypatia-a3c9mn/docs" target="_blank" rel="noreferrer">Repository docs</a>
        </div>
      </section>
    </div>
  );
}