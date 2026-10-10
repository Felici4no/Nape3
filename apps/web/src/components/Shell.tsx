import Link from "next/link";
import { getMarketSource } from "@/lib/source.server";
import styles from "./Shell.module.css";

const NAV = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/agentes", label: "Agents" },
  { href: "/transparencia", label: "Transparency" },
  { href: "/docs", label: "Docs" }
];

/** Name on the left, text navigation and the install call to action on the right; phones get the bottom bar instead. */
export function TopBar() {
  return (
    <header className={styles.bar}>
      <div className={`wrap ${styles.inner}`}>
        <Link href="/" className={styles.word} aria-label="UPAY3FOOD home">
          UPAY<span>3</span>FOOD
        </Link>
        <nav className={styles.links} aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}>{n.label}</Link>
          ))}
        </nav>
        <Link href="/instalar" className={`btn ${styles.cta}`}>Install</Link>
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

const FOOTER = [
  { title: "Product", links: [["/instalar", "Extension"], ["/agentes", "Agents (MCP)"], ["/#how-it-works", "How it works"], ["/market", "Market board (demo)"]] },
  { title: "Solana", links: [["/transparencia", "Transparency"], ["/wallet", "Wallet"], ["/shield", "Cloak shield"], ["/privacy", "What stays private"]] },
  { title: "Project", links: [["/docs", "Docs"], ["/docs/07-hackathon", "Hackathon"], ["https://github.com/Felici4no/Nape3-UPAY3FOOD", "GitHub"]] }
] as const;

export function Footer() {
  return (
    <footer className={`night ${styles.footer}`}>
      <div className="wrap">
        <div className={styles.top}>
          <p className={`display ${styles.sentence}`}>Stop paying the third time.</p>
          <Link href="/instalar" className={`btn ${styles.footCta}`}>Install the extension</Link>
        </div>
        <div className={styles.cols}>
          {FOOTER.map((c) => (
            <div key={c.title}>
              <span className="eyebrow">{c.title}</span>
              <ul>
                {c.links.map(([href, label]) => (
                  <li key={href}>{href.startsWith("http") ? <a href={href}>{label}</a> : <Link href={href}>{label}</Link>}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className={`small ${styles.fine}`}>
          Reads only what is on your screen, in your own iFood session. Never places an order or pays on its own. Menu prices are estimates until the
          bag confirms them: coupons, membership and address change the total. The Pix off-ramp stays off until a licensed partner exists. Not affiliated
          with iFood, Rappi, 99Food or Keeta.
        </p>
      </div>
    </footer>
  );
}
