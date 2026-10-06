import Link from "next/link";
import { docs, docsGeneratedAt, groups, latestNotes, plainTitle } from "@/lib/docs";
import styles from "./docs.module.css";

export default function DocsHome() {
  const all = groups();
  const log = latestNotes(8);
  return (
    <>
      <div className={styles.hero}>
        <div>
          <span className={styles.eyebrowDark}>UPAY3FOOD · documentation · {docs.length} notes</span>
          <h1>Build log, architecture, proof.</h1>
          <p className={styles.lede}>
            How UPAY3FOOD observes the food market, decides and funds the purchase privately. Every note here is a Markdown file in the repository,
            published as written: decisions, incidents, spikes and on-chain proofs included.
          </p>
        </div>
        <div className={styles.status}>
          <span className={styles.eyebrowDark}>Latest verified milestone</span>
          <strong>1.000000 USDC SHIELDED</strong>
          <div>Solana mainnet · slot 453687294 · 2026-10-05</div>
          <div className={styles.actions}>
            <Link className="btn light" href="/docs/proofs/2026-10-05-mainnet-shield">
              Open proof
            </Link>
          </div>
        </div>
      </div>

      <p className={styles.sectionTitle}>Build log</p>
      <ul className={styles.log}>
        {log.map((d) => (
          <li key={d.slug}>
            <Link href={`/docs/${d.slug}`}>
              <time>{d.date}</time>
              <em>{d.groupLabel}</em>
              <span>{plainTitle(d.title)}</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className={styles.sectionTitle}>Sections</p>
      <div className={styles.cards}>
        {all.map((g) => {
          const first = g.docs[0]!;
          return (
            <Link className={styles.card} href={`/docs/${first.slug}`} key={g.key || "general"}>
              <span className={styles.count}>
                {g.docs.length} note{g.docs.length === 1 ? "" : "s"}
              </span>
              <h3>{g.label}</h3>
              <p>{g.docs.map((d) => plainTitle(d.title)).slice(0, 3).join(" · ")}</p>
            </Link>
          );
        })}
      </div>

      <p className={styles.sectionTitle}>Boundary</p>
      <div className={styles.section}>
        <h2>What is real today</h2>
        <p>
          The Cloak shield is real on Solana mainnet. The licensed off-ramp → BRL → Pix merchant settlement remains disabled. Market prices are
          observations from the user&apos;s own iFood session, not offers. Documentation keeps those claims separate.
        </p>
      </div>
      <p className="small" style={{ color: "var(--night-ink-2)", marginTop: 24 }}>
        Index built {new Date(docsGeneratedAt).toISOString().slice(0, 16).replace("T", " ")} UTC from the repository.
      </p>
    </>
  );
}
