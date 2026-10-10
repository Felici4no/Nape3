import Link from "next/link";
import info from "@/generated/transparency.json";
import anchors from "@/data/anchors.json";
import { AnchorPanel } from "./AnchorPanel";
import styles from "./transparencia.module.css";

export const metadata = {
  title: "Transparency",
  description: "UPAY3FOOD's methodology and calculation code, with their hash anchored on Solana mainnet. Anyone can verify it."
};

export type Anchor = { signature: string; slot: number | null; signer: string; methodologySha256: string; engineSha256: string; commit: string | null; anchoredAt: string };

export default function Transparencia() {
  const list = anchors as Anchor[];
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className="wrap">
          <span className={styles.kicker}>Solana mainnet · SPL Memo · verifiable by anyone</span>
          <h1 className={`display ${styles.title}`}>The numbers can’t quietly change.</h1>
          <p className={styles.lede}>
            Every version of the methodology and of the code that computes the price per litre, the 3 layers and the recommendation becomes a SHA-256 hash.
            That hash is anchored on Solana. If anyone changes the rule later, the hash no longer matches.
          </p>
        </div>
      </section>

      <section className="wrap">
        <h2 className={`display ${styles.h2}`}>This version</h2>
        <dl className={styles.hashes}>
          <div>
            <dt>Methodology</dt>
            <dd>
              <Link href="/docs/05-architecture/price-calculations">{info.methodologyFile}</Link>
              <code className="num">{info.methodologySha256}</code>
            </dd>
          </div>
          <div>
            <dt>Calculation code</dt>
            <dd>
              <span className="muted small">{info.engineFiles.join(" + ")}</span>
              <code className="num">{info.engineSha256}</code>
            </dd>
          </div>
          <div>
            <dt>Commit</dt>
            <dd>
              <code className="num">{info.commit ?? "—"}</code>
            </dd>
          </div>
        </dl>
        <pre className={styles.cmd}><code>{`# check it yourself, in the repository
sha256sum ${info.methodologyFile}
cat ${info.engineFiles.join(" ")} | sha256sum`}</code></pre>
      </section>

      <section className="wrap">
        <h2 className={`display ${styles.h2}`}>Anchors on Solana</h2>
        <AnchorPanel current={{ methodologySha256: info.methodologySha256, engineSha256: info.engineSha256, commit: info.commit }} anchors={list} />
      </section>

      <section className={`wrap ${styles.why}`}>
        <h2 className={`display ${styles.h2}`}>Why it matters</h2>
        <ul>
          <li><b>For users:</b> the rule that says “the 700 ml is cheaper per litre” is public and cannot change behind their back.</li>
          <li><b>For platforms:</b> a comparison with objective, published criteria — what was missing in the Taxômetro case (99Food, 2026).</li>
          <li><b>For regulators and researchers:</b> future delivery price indexes can be verified batch by batch, the same way.</li>
        </ul>
        <p className="muted small">The anchor stores only hashes. No user price, address or personal data goes on-chain.</p>
      </section>
    </div>
  );
}
