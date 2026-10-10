"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./BottomNav.module.css";

/**
 * 24×24 icons drawn for this bar: one 1.7 stroke, round joins, and a soft
 * fill (`.tint`) on one shape each that warms up when the item is active.
 */
const ICONS = {
  home: (
    <>
      <path className="tint" d="M10 20v-4.5a2 2 0 0 1 4 0V20Z" />
      <path d="M3.8 10.4 12 3.8l8.2 6.6" />
      <path d="M5.8 8.9V18.5a1.5 1.5 0 0 0 1.5 1.5h9.4a1.5 1.5 0 0 0 1.5-1.5V8.9" />
      <path d="M10 20v-4.5a2 2 0 0 1 4 0V20" />
    </>
  ),
  extension: (
    <>
      <path
        className="tint"
        d="M7 4.8h2.8a2.2 2.2 0 1 1 4.4 0H17a1.5 1.5 0 0 1 1.5 1.5v2.8a2.2 2.2 0 1 1 0 4.4v4.2a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5V6.3A1.5 1.5 0 0 1 7 4.8Z"
      />
      <path d="M7 4.8h2.8a2.2 2.2 0 1 1 4.4 0H17a1.5 1.5 0 0 1 1.5 1.5v2.8a2.2 2.2 0 1 1 0 4.4v4.2a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5V6.3A1.5 1.5 0 0 1 7 4.8Z" />
    </>
  ),
  agent: (
    <>
      <path d="M5.3 4.8h13.4a1.8 1.8 0 0 1 1.8 1.8v8.6a1.8 1.8 0 0 1-1.8 1.8H12l-4.6 3.4v-3.4H5.3a1.8 1.8 0 0 1-1.8-1.8V6.6a1.8 1.8 0 0 1 1.8-1.8Z" />
      <path className="tint solid" d="M12 7.4l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1Z" />
    </>
  ),
  proof: (
    <>
      <circle className="tint" cx="12" cy="9.6" r="5.9" />
      <circle cx="12" cy="9.6" r="5.9" />
      <path d="m9.6 9.7 1.7 1.7 3.1-3.3" />
      <path d="M8.6 14.5 7.3 20.3l4.7-2.1 4.7 2.1-1.3-5.8" />
    </>
  ),
  wallet: (
    <>
      <rect className="tint" x="3.5" y="6.8" width="17" height="12.7" rx="3" />
      <path d="M16.6 6.8V5.4a1.5 1.5 0 0 0-1.9-1.45L6 6.8" />
      <rect x="3.5" y="6.8" width="17" height="12.7" rx="3" />
      <path d="M20.5 11.4h-3.4a1.75 1.75 0 0 0 0 3.5h3.4" />
      <circle className="solid" cx="17.2" cy="13.15" r="0.75" />
    </>
  )
};

const ITEMS: Array<{ href: string; label: string; icon: keyof typeof ICONS }> = [
  { href: "/", label: "Início", icon: "home" },
  { href: "/instalar", label: "Instalar", icon: "extension" },
  { href: "/agentes", label: "Agentes", icon: "agent" },
  { href: "/transparencia", label: "Prova", icon: "proof" },
  { href: "/wallet", label: "Carteira", icon: "wallet" }
];

/**
 * Floating bottom navigation, phones only (the header carries the links on wider screens). Each destination is an icon; the current one
 * opens to show its name beside the icon (a grid 0fr → 1fr transition, so
 * the pill animates to the label's real width).
 */
export function BottomNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className={styles.dock} aria-label="Atalhos">
      <ul className={styles.bar}>
        {ITEMS.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`${styles.item} ${active ? styles.active : ""}`}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                title={item.label}
              >
                <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
                  {ICONS[item.icon]}
                </svg>
                <span className={styles.label} aria-hidden="true">
                  <span>{item.label}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
