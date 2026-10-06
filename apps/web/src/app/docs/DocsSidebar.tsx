"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import styles from "./docs.module.css";

interface NavGroup {
  key: string;
  label: string;
  items: Array<{ slug: string; title: string }>;
}

/** Every note, grouped by folder; the current one is highlighted and its group open. On phones it collapses behind a button. */
export function DocsSidebar({ nav }: { nav: NavGroup[] }) {
  const pathname = usePathname() ?? "";
  const current = decodeURIComponent(pathname.replace(/^\/docs\/?/, ""));
  const [open, setOpen] = useState(false);
  return (
    <aside className={styles.side} data-open={open} aria-label="All notes">
      <button className={styles.menuToggle} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Close index" : "All notes"}
      </button>
      <div className={styles.groups}>
        {nav.map((group) => (
          <details key={group.key || "general"} open={group.items.some((i) => i.slug === current) || group.key === "" || current === ""}>
            <summary>
              {group.label} · {group.items.length}
            </summary>
            <ul>
              {group.items.map((item) => (
                <li key={item.slug}>
                  <Link href={`/docs/${item.slug}`} aria-current={item.slug === current ? "page" : undefined} onClick={() => setOpen(false)}>
                    {item.title}
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </aside>
  );
}
