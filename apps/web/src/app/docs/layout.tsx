import type { Metadata } from "next";
import Link from "next/link";
import { groups } from "@/lib/docs";
import { DocsSidebar } from "./DocsSidebar";
import styles from "./docs.module.css";

export const metadata: Metadata = {
  title: { default: "Docs", template: "%s · UPAY3FOOD docs" },
  description: "UPAY3FOOD build log: product, architecture, decisions, incidents, spikes and on-chain proofs."
};

/** Dark documentation shell. The site's own header, banner, footer and bottom bar are hidden here (globals.css, [data-docs]). */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const nav = groups().map((g) => ({ key: g.key, label: g.label, items: g.docs.map((d) => ({ slug: d.slug, title: d.title.replace(/`/g, "") })) }));
  return (
    <div className={styles.shell} data-docs>
      <div className={styles.top}>
        <Link href="/docs" className={styles.brand}>
          <strong>
            UPAY<span>3</span>FOOD
          </strong>
          <em>DOCS</em>
        </Link>
        <nav className={styles.topLinks} aria-label="Docs">
          <a href="https://upay3food.com">Site</a>
          <a href="https://upay3food.com/diagnostics">Diagnostics</a>
          <a href="https://github.com/Felici4no/Nape3-UPAY3FOOD/tree/claude/youthful-hypatia-a3c9mn" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </div>
      <div className={styles.body}>
        <DocsSidebar nav={nav} />
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
