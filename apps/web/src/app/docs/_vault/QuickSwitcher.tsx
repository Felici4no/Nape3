"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import styles from "./vault.module.css";

export interface SwitcherNote { slug: string; title: string; path: string; summary: string }

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Scores a note for a query: every word must appear; title hits rank above path, path above summary. */
function score(n: SwitcherNote, words: string[]): number {
  let total = 0;
  const t = norm(n.title);
  const p = norm(n.path);
  const s = norm(n.summary);
  for (const w of words) {
    if (t.startsWith(w)) total += 6;
    else if (t.includes(w)) total += 4;
    else if (p.includes(w)) total += 2;
    else if (s.includes(w)) total += 1;
    else return -1;
  }
  return total;
}

export const OPEN_SWITCHER = "vault:open-switcher";

/** Quick switcher (⌘K / Ctrl+K / Ctrl+O): type to filter every note, arrows to move, Enter to open. */
export function QuickSwitcher({ notes }: { notes: SwitcherNote[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "o")) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SWITCHER, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SWITCHER, onOpen);
    };
  }, []);
  useEffect(() => {
    if (open) {
      setQ("");
      setI(0);
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return notes.slice(0, 12);
    return notes
      .map((n) => ({ n, s: score(n, words) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((r) => r.n);
  }, [q, notes]);

  const go = useCallback(
    (n: SwitcherNote | undefined) => {
      if (!n) return;
      setOpen(false);
      router.push(`/docs/${n.slug}`);
    },
    [router]
  );

  if (!open) return null;
  return (
    <div className={styles.modalBackdrop} onMouseDown={() => setOpen(false)}>
      <div className={styles.modal} role="dialog" aria-label="Quick switcher" onMouseDown={(e) => e.stopPropagation()}>
        <div className={styles.modalInput}>
          <Icon name="search" size={16} />
          <input
            ref={input}
            value={q}
            placeholder="Find or open a note…"
            onChange={(e) => {
              setQ(e.target.value);
              setI(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setI((x) => Math.min(x + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setI((x) => Math.max(x - 1, 0));
              } else if (e.key === "Enter") go(results[i]);
            }}
            aria-label="Search notes"
          />
        </div>
        <ul className={styles.results} role="listbox">
          {results.map((n, k) => (
            <li key={n.slug} role="option" aria-selected={k === i} onMouseEnter={() => setI(k)} onClick={() => go(n)}>
              <strong>{n.title}</strong>
              <span>{n.path}</span>
            </li>
          ))}
          {!results.length && <li className={styles.empty}>No note matches “{q}”.</li>}
        </ul>
        <div className={styles.modalHints}>
          <span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
          <span><kbd>↵</kbd> to open</span>
          <span><kbd>esc</kbd> to dismiss</span>
        </div>
      </div>
    </div>
  );
}
