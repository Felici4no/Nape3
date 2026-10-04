import Link from "next/link";
import { getMarketSource } from "@/lib/source.server";
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

/** States which market the site is showing; the live/demo switch exists only outside production. */
export async function DataBanner() {
  const source = await getMarketSource();
  const n = source.observations.length;
  const toggle = source.switchAllowed ? (
    <a className={styles.toggle} href={`/api/dev/data-mode?mode=${source.mode === "live" ? "demo" : "live"}`}>
      {source.mode === "live" ? "Show synthetic demo" : "Show live market"} (dev)
    </a>
  ) : null;

  if (source.mode === "demo") {
    const why =
      source.reason === "no-observer-configured"
        ? "No observer API is configured (OBSERVER_API_URL), so the site falls back to deterministic fixtures with fictitious merchants."
        : "Selected explicitly; live observations are hidden while it is on.";
    return (
      <div className={styles.banner} role="note">
        <div className="wrap">
          <strong>Synthetic demo data.</strong> {why} Nothing here is a real iFood, Rappi or 99Food price. {toggle}
        </div>
      </div>
    );
  }
  if (source.status === "unavailable") {
    return (
      <div className={`${styles.banner} ${styles.bannerWarn}`} role="alert">
        <div className="wrap">
          <strong>Live market unavailable.</strong> {source.error}. No synthetic data is shown in its place. {toggle}
        </div>
      </div>
    );
  }
  return (
    <div className={`${styles.banner} ${styles.bannerLive}`} role="note">
      <div className="wrap">
        <strong>Live observations.</strong>{" "}
        {n === 0
          ? "No real checkouts observed in the last 7 days yet. Prices appear as the extension records them."
          : `${n} real checkout observation${n === 1 ? "" : "s"} from the last 7 days, recorded by the extension. Observations, not offers.`}{" "}
        {toggle}
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
