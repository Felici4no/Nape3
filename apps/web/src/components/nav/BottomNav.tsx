"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./BottomNav.module.css";

/** 24×24 stroke icons, drawn for this bar so they share one weight and corner style. */
const ICONS = {
  market: (
    <>
      <path d="M3.5 9.5 5 4.5h14l1.5 5" />
      <path d="M4.5 9.5V20h15V9.5" />
      <path d="M3.5 9.5h17a2.8 2.8 0 0 1-5.6 0 2.8 2.8 0 0 1-5.8 0 2.8 2.8 0 0 1-5.6 0" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  agent: (
    <>
      <path d="M11 3.5 12.9 8.6 18 10.5 12.9 12.4 11 17.5 9.1 12.4 4 10.5 9.1 8.6Z" />
      <path d="M18.5 15.5 19.3 17.7 21.5 18.5 19.3 19.3 18.5 21.5 17.7 19.3 15.5 18.5 17.7 17.7Z" />
    </>
  ),
  wallet: (
    <>
      <path d="M17.5 6.5V5.8A1.8 1.8 0 0 0 15.3 4L5 6.3A2 2 0 0 0 3.5 8.2" />
      <rect x="3.5" y="6.5" width="17" height="13" rx="2.5" />
      <path d="M20.5 11h-3.8a2 2 0 0 0 0 4h3.8" />
    </>
  ),
  pay: <path d="M13.5 2.5 5 13.5h6.5l-1 8 8.5-11h-6.5Z" />,
  privacy: (
    <>
      <path d="M12 3 19.5 6v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  )
};

const ITEMS: Array<{ href: string; label: string; icon: keyof typeof ICONS }> = [
  { href: "/market", label: "Market", icon: "market" },
  { href: "/agent", label: "Agent", icon: "agent" },
  { href: "/wallet", label: "Wallet", icon: "wallet" },
  { href: "/pay", label: "Pay", icon: "pay" },
  { href: "/privacy", label: "Privacy", icon: "privacy" }
];

/**
 * Floating bottom navigation. Each destination is an icon; the current one
 * opens to show its name beside the icon (a grid 0fr → 1fr transition, so
 * the pill animates to the label's real width).
 */
export function BottomNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className={styles.dock} aria-label="Main">
      <ul className={styles.bar}>
        {ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
