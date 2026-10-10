import Link from "next/link";
import { getMarketSource } from "@/lib/source.server";
import styles from "./Shell.module.css";

/** The header carries only the name, centered; navigation lives in the bottom bar (BottomNav). */
export function TopBar() {
  return (
    <header className={styles.bar}>
      <div className={`wrap ${styles.inner}`}>
        <Link href="/" className={styles.word} aria-label="UPAY3FOOD home">
          UPAY<span>3</span>FOOD
        </Link>
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
        <p className={`display ${styles.sentence}`}>Pare de pagar a terceira vez.</p>
        <div className={styles.cols}>
          <p>
            <Link href="/instalar">Extensão</Link> · <Link href="/agentes">Agentes (MCP)</Link> · <Link href="/transparencia">Transparência</Link> ·{" "}
            <Link href="/docs">Docs</Link> · <a href="https://github.com/Felici4no/Nape3-UPAY3FOOD">GitHub</a>
            <br />
            Lê só o que está na sua tela, na sua sessão do iFood. Nunca faz pedido nem paga sozinha.
          </p>
          <p className="small">
            Preços de cardápio são estimativas até a sacola: cupons, Clube e endereço mudam o valor. O repasse para Pix fica desligado até
            existir um parceiro licenciado. Sem afiliação com iFood, Rappi, 99Food ou Keeta.
          </p>
        </div>
      </div>
    </footer>
  );
}
