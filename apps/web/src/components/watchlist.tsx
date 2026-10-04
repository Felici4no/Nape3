"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { InstrumentQuote } from "@/lib/market";
import { Change, Freshness, Price } from "./bits";
import styles from "./watchlist.module.css";

const KEY = "upay3food.watchlist";
const EVENT = "upay3food:watchlist";

function read(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function write(slugs: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(slugs));
  } catch {
    /* private mode: watchlist lives only for this page view */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useWatchlist(): [string[], (slug: string) => void] {
  const [slugs, setSlugs] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => setSlugs(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const toggle = (slug: string) => write(read().includes(slug) ? read().filter((s) => s !== slug) : [...read(), slug]);
  return [slugs, toggle];
}

export function WatchButton({ slug, name }: { slug: string; name: string }) {
  const [slugs, toggle] = useWatchlist();
  const on = slugs.includes(slug);
  return (
    <button
      type="button"
      className={`${styles.star} ${on ? styles.on : ""}`}
      aria-pressed={on}
      aria-label={on ? `Remove ${name} from watchlist` : `Add ${name} to watchlist`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(slug);
      }}
    >
      {on ? "★ Watching" : "☆ Watch"}
    </button>
  );
}

export function Watchlist({ quotes }: { quotes: InstrumentQuote[] }) {
  const [slugs] = useWatchlist();
  const watched = quotes.filter((q) => slugs.includes(q.instrument.slug));
  if (watched.length === 0) {
    return (
      <div className={styles.empty}>
        <p>Nothing on your watchlist yet.</p>
        <p className="muted small">Tap ☆ Watch on any market card. Your watchlist stays in this browser.</p>
      </div>
    );
  }
  return (
    <div className={styles.rows}>
      {watched.map((q) => (
        <Link key={q.instrument.slug} href={`/market/${q.instrument.slug}`} className={styles.row}>
          <span className={styles.name}>{q.instrument.name}</span>
          <Price cents={q.summary.medianCents} usdc={q.usdc.median} size="m" />
          <Change change={q.change} compact />
          <Freshness minutes={q.summary.freshness.newestAgeMinutes} count={q.summary.sampleSize} />
        </Link>
      ))}
    </div>
  );
}
