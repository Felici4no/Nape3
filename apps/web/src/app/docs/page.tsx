import Link from "next/link";
import { docBySlug, docs, docsGeneratedAt, graph, groups, latestNotes, plainTitle } from "@/lib/docs";
import { Graph } from "./_vault/Graph";
import { Icon } from "./_vault/icons";
import styles from "./_vault/vault.module.css";

/** Vault home: the whole graph, the build log and the folders. */
export default function DocsHome() {
  const nodes = graph.nodes.map((n) => ({ ...n, title: plainTitle(docBySlug(n.slug)?.title ?? n.slug) }));
  const links = graph.edges.filter((e) => e[2] === "link").length;
  const log = latestNotes(6);
  return (
    <div className={styles.home}>
      <div className={styles.viewHeader}>
        <div className={styles.crumbs}>
          <span><strong>Graph view</strong></span>
        </div>
        <span className={styles.headerMeta}>
          {docs.length} notes · {links} links · built {new Date(docsGeneratedAt).toISOString().slice(0, 10)}
        </span>
      </div>

      <div className={styles.homeGraph}>
        <Graph nodes={nodes} edges={graph.edges} aspect={0.5} />
        <div className={styles.graphIntro}>
          <span className={styles.kicker}>UPAY3FOOD vault</span>
          <h1>Build log, architecture, proof.</h1>
          <p>
            Every note is a Markdown file in the repository, published as written: decisions, incidents, spikes and on-chain proofs included. Hover a
            node to see what it links to; click to open it. Press <kbd>⌘K</kbd> to search.
          </p>
        </div>
      </div>

      <div className={styles.homeGrid}>
        <section className={styles.panel}>
          <h2><Icon name="calendar" size={15} /> Build log</h2>
          <ul className={styles.logList}>
            {log.map((d) => (
              <li key={d.slug}>
                <Link href={`/docs/${d.slug}`}>
                  <time>{d.date}</time>
                  <span>{plainTitle(d.title)}</span>
                  <em>#{d.kind}</em>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className={`${styles.panel} ${styles.milestone}`}>
          <h2><Icon name="tag" size={15} /> Latest verified milestone</h2>
          <strong>1.000000 USDC shielded</strong>
          <p>Cloak shield on Solana mainnet · slot 453687294 · 2026-10-05</p>
          <Link href="/docs/proofs/2026-10-05-mainnet-shield" className={styles.accentLink}>Open proof →</Link>
          <div className="callout" data-callout="warning">
            <div className="callout-title">Boundary</div>
            <div className="callout-content">
              <p>The licensed off-ramp to Pix stays disabled. Menu prices are observations from the user&apos;s own session, not offers.</p>
            </div>
          </div>
        </section>
      </div>

      <section className={styles.panel}>
        <h2><Icon name="folder" size={15} /> Folders</h2>
        <div className={styles.folderGrid}>
          {groups().map((g) => (
            <Link key={g.key || "root"} href={`/docs/${g.docs[0]!.slug}`} className={styles.folderCard}>
              <span className={styles.folderName}><Icon name="folder" size={14} /> {g.key || "/"}</span>
              <strong>{g.label}</strong>
              <span>{g.docs.length} note{g.docs.length === 1 ? "" : "s"}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
