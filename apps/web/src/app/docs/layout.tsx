import type { Metadata } from "next";
import { docs, plainTitle, vaultTree } from "@/lib/docs";
import { Ribbon, Tabs } from "./_vault/Chrome";
import { Explorer } from "./_vault/Explorer";
import { QuickSwitcher } from "./_vault/QuickSwitcher";
import styles from "./_vault/vault.module.css";

export const metadata: Metadata = {
  title: { default: "Docs", template: "%s · UPAY3FOOD docs" },
  description: "UPAY3FOOD vault: product, architecture, decisions, incidents, spikes and on-chain proofs, linked like a knowledge base."
};

const REPO = "https://github.com/Felici4no/Nape3-UPAY3FOOD/tree/claude/youthful-hypatia-a3c9mn";

/**
 * Docs as a vault: ribbon, file explorer, tabs, the note, and a right pane
 * (outline, local graph). The site's own header, footer and bottom bar are
 * hidden here (globals.css, [data-docs]).
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const { root, folders } = vaultTree();
  const titles: Record<string, string> = Object.fromEntries(docs.map((d) => [d.slug, plainTitle(d.title)]));
  titles["proofs/2026-10-05-mainnet-shield"] = "Proof · first mainnet Cloak shield";
  const notes = docs.map((d) => ({ slug: d.slug, title: plainTitle(d.title), path: d.source.replace(/^docs\//, ""), summary: d.summary }));
  return (
    <div className={styles.app} data-docs>
      <Ribbon repo={REPO} />
      <aside className={styles.left}>
        <Explorer root={root} folders={folders} vaultName="upay3food" />
      </aside>
      <div className={styles.workspace}>
        <Tabs titles={titles} />
        <div className={styles.view}>{children}</div>
      </div>
      <QuickSwitcher notes={notes} />
    </div>
  );
}
