"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { OPEN_SWITCHER } from "./QuickSwitcher";
import styles from "./vault.module.css";

const openSwitcher = () => window.dispatchEvent(new Event(OPEN_SWITCHER));
const toggleExplorer = () => {
  const el = document.documentElement;
  if (el.hasAttribute("data-vault-explorer")) el.removeAttribute("data-vault-explorer");
  else el.setAttribute("data-vault-explorer", "");
};

/** Left ribbon: the vault's actions as icons. */
export function Ribbon({ repo }: { repo: string }) {
  const pathname = usePathname() ?? "";
  return (
    <div className={styles.ribbon} aria-label="Vault actions">
      <button type="button" className={styles.ribbonBtn} onClick={toggleExplorer} title="Toggle file explorer" aria-label="Toggle file explorer">
        <Icon name="sidebar" size={18} />
      </button>
      <button type="button" className={styles.ribbonBtn} onClick={openSwitcher} title="Quick switcher (⌘K)" aria-label="Quick switcher">
        <Icon name="search" size={18} />
      </button>
      <Link href="/docs" className={styles.ribbonBtn} aria-current={pathname === "/docs" ? "page" : undefined} title="Graph view" aria-label="Graph view">
        <Icon name="graph" size={18} />
      </Link>
      <span className={styles.ribbonGap} />
      <a href="https://upay3food.com" className={styles.ribbonBtn} title="upay3food.com" aria-label="Website">
        <Icon name="home" size={18} />
      </a>
      <a href={repo} className={styles.ribbonBtn} target="_blank" rel="noreferrer" title="GitHub" aria-label="GitHub">
        <Icon name="github" size={18} />
      </a>
    </div>
  );
}

const TABS_KEY = "upay3food.vault.tabs";

/**
 * Tab strip: the notes opened in this browser session (at most five), the
 * current one active. Kept in sessionStorage; renders fine without it.
 */
export function Tabs({ titles }: { titles: Record<string, string> }) {
  const pathname = usePathname() ?? "/docs";
  const current = decodeURIComponent(pathname.replace(/^\/docs\/?/, "")) || "";
  const [tabs, setTabs] = useState<string[]>([]);
  useEffect(() => {
    let saved: string[] = [];
    try {
      saved = JSON.parse(sessionStorage.getItem(TABS_KEY) ?? "[]");
    } catch {
      /* storage blocked */
    }
    const next = saved.filter((s) => s in titles || s === "");
    if (!next.includes(current)) next.push(current);
    const trimmed = next.slice(-5);
    setTabs(trimmed);
    try {
      sessionStorage.setItem(TABS_KEY, JSON.stringify(trimmed));
    } catch {
      /* storage blocked */
    }
  }, [current, titles]);

  const close = (slug: string) => {
    const next = tabs.filter((t) => t !== slug);
    setTabs(next);
    try {
      sessionStorage.setItem(TABS_KEY, JSON.stringify(next));
    } catch {
      /* storage blocked */
    }
  };
  const shown = tabs.length ? tabs : [current];
  return (
    <div className={styles.tabs} role="tablist">
      <button type="button" className={`${styles.iconBtn} ${styles.mobileOnly}`} onClick={toggleExplorer} aria-label="Files">
        <Icon name="sidebar" size={16} />
      </button>
      {shown.map((slug) => {
        const active = slug === current;
        const label = slug === "" ? "Graph view" : titles[slug] ?? slug;
        return (
          <div key={slug || "graph"} className={styles.tab} role="tab" aria-selected={active}>
            <Link href={`/docs${slug ? `/${slug}` : ""}`} title={label}>
              <Icon name={slug === "" ? "graph" : "file"} size={13} />
              <span>{label}</span>
            </Link>
            {!active && (
              <button type="button" onClick={() => close(slug)} aria-label={`Close ${label}`}>
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
        );
      })}
      <button type="button" className={styles.newTab} onClick={openSwitcher} title="Open another note (⌘K)" aria-label="Open another note">
        +
      </button>
    </div>
  );
}
