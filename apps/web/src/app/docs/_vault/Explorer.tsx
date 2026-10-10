"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { VaultFolder } from "@/lib/docs";
import { Icon } from "./icons";
import styles from "./vault.module.css";

type File = VaultFolder["files"][number];

function FileRow({ f, current, depth }: { f: File; current: string; depth: number }) {
  return (
    <Link
      href={`/docs/${f.slug}`}
      className={styles.fileRow}
      aria-current={f.slug === current ? "page" : undefined}
      title={f.title}
      style={{ paddingLeft: 10 + depth * 16 }}
      onClick={() => document.documentElement.removeAttribute("data-vault-explorer")}
    >
      {f.file}
    </Link>
  );
}

/** File explorer: folders collapse like a vault's; the open note's folder starts open. */
export function Explorer({ root, folders, vaultName }: { root: File[]; folders: VaultFolder[]; vaultName: string }) {
  const pathname = usePathname() ?? "";
  const current = decodeURIComponent(pathname.replace(/^\/docs\/?/, ""));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const f = folders.find((g) => g.files.some((x) => x.slug === current));
    if (f) setOpen((o) => ({ ...o, [f.key]: true }));
  }, [current, folders]);

  const allOpen = folders.every((f) => open[f.key]);
  return (
    <div className={styles.explorer}>
      <div className={styles.paneHead}>
        <span>Files</span>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => setOpen(Object.fromEntries(folders.map((f) => [f.key, !allOpen])))}
          title={allOpen ? "Collapse all" : "Expand all"}
          aria-label={allOpen ? "Collapse all" : "Expand all"}
        >
          <Icon name={allOpen ? "arrowUp" : "list"} size={15} />
        </button>
      </div>
      <div className={styles.vaultName}>
        <Icon name="folderOpen" size={15} /> {vaultName}
      </div>
      <nav className={styles.tree} aria-label="All notes">
        {folders.map((f) => (
          <div key={f.key}>
            <button
              type="button"
              className={styles.folderRow}
              aria-expanded={!!open[f.key]}
              onClick={() => setOpen((o) => ({ ...o, [f.key]: !o[f.key] }))}
              title={f.label}
            >
              <Icon name="chevron" size={13} className={styles.chev} />
              {f.name}
              <span className={styles.count}>{f.files.length}</span>
            </button>
            {open[f.key] && (
              <div className={styles.children}>
                {f.files.map((x) => (
                  <FileRow key={x.slug} f={x} current={current} depth={1} />
                ))}
              </div>
            )}
          </div>
        ))}
        {root.map((x) => (
          <FileRow key={x.slug} f={x} current={current} depth={0} />
        ))}
      </nav>
    </div>
  );
}
