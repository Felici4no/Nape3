import Link from "next/link";
import { DATA_SOURCE } from "@/lib/market";
import styles from "./Shell.module.css";

const NAV = [
  { href: "/market", label: "Market" },
  { href: "/agent", label: "Agent" },
  { href: "/wallet", label: "Wallet" },
  { href: "/pay", label: "Pay" },
  { href: "/privacy", label: "Privacy" }
];

export function TopBar() {
  return (
    <header className={styles.bar}>
      <div className={`wrap ${styles.inner}`}>
        <Link href="/" className={styles.logo} aria-label="UPAY3FOOD.agent home">
          <span className={styles.mark}>U3</span>
          <span className={styles.word}>UPAY3FOOD<span>.agent</span></span>
        </Link>
        <nav className={styles.nav} aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}>{n.label}</Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function DataBanner() {
  if (!DATA_SOURCE.synthetic) return null;
  return (
    <div className={styles.banner} role="note">
      <div className="wrap">
        <strong>{DATA_SOURCE.label}.</strong> {DATA_SOURCE.detail}
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer className={`night ${styles.footer}`}>
      <div className="wrap">
        <p className={`display ${styles.sentence}`}>Find the lowest valid way to complete the purchase.</p>
        <div className={styles.cols}>
          <p>
            <strong>Website</strong> · market, agent, wallet and private payment.
            <br />
            <strong>Extension</strong> · observes prices in your own iFood session, reads your checkout and detects Pix.
          </p>
          <p className="small">
            Prices are observations, not offers: a price seen in another account may not be available to yours. Pix settlement is
            disabled until a licensed off-ramp is integrated. No affiliation with iFood, Rappi or 99Food.
          </p>
        </div>
      </div>
    </footer>
  );
}
