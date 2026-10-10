import Link from "next/link";
import packed from "@/generated/extension-info.json";
import styles from "./instalar.module.css";

export const metadata = {
  title: "Install the extension",
  description: "You pay three times for food. The UPAY3FOOD extension shows all three and takes you to the cheaper option."
};

type ExtensionInfo = { version: string; sizeBytes: number; sha256: string; builtAt: string; commit: string | null };

function extensionInfo(): ExtensionInfo | null {
  const info = packed as unknown as { version: string | null } & Omit<ExtensionInfo, "version">;
  return info.version ? (info as ExtensionInfo) : null;
}

const STEPS = [
  { t: "Download and unzip", d: "Download the .zip and unzip it into a folder you will keep, for example Documents/upay3food.", visual: "zip" },
  { t: "Turn on developer mode", d: "In Chrome, Edge or Brave, open chrome://extensions and flip the switch in the top-right corner.", visual: "toggle" },
  { t: "Load the folder", d: "Click “Load unpacked” and pick the folder that contains manifest.json.", visual: "load" },
  { t: "Open iFood", d: "Pin the icon to the toolbar, go to ifood.com.br and open a shop. No login needed.", visual: "ifood" }
] as const;

const VIEWS = [
  { img: "/instalar/raio-x.png", w: 760, h: 1332, t: "On a product", d: "The three layers of the price and the Price X-ray: per 100 ml, per litre, per person, and how much of the product the fees are worth." },
  { img: "/instalar/tamanho.png", w: 760, h: 626, t: "In a shop", d: "The whole menu ranked by price per 100 ml (or per 100 g of meat). Tubs and drinks get their own comparisons." },
  { img: "/instalar/sacola.png", w: 760, h: 1240, t: "In the bag", d: "Every number comes from the page and is checked against the total: subtotal, delivery, service fee and discount." }
];

function StepVisual({ kind }: { kind: (typeof STEPS)[number]["visual"] }) {
  if (kind === "zip") return <div className={styles.vZip}><span>upay3food-extension.zip</span><b>↓</b></div>;
  if (kind === "toggle")
    return (
      <div className={styles.vBar}>
        <span className="num">chrome://extensions</span>
        <span className={styles.vToggle}>Developer mode <i /></span>
      </div>
    );
  if (kind === "load") return <div className={styles.vBtns}><span className={styles.vBtnOn}>Load unpacked</span><span>Pack extension</span></div>;
  return <div className={styles.vBar}><span className="num">ifood.com.br/delivery/…</span><span className={styles.vBadge}>U3</span></div>;
}

export default function Instalar() {
  const info = extensionInfo();
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={`wrap ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <span className={styles.kicker}>Install · browser extension</span>
            <h1 className={`display ${styles.title}`}>
              Bring the <span className={styles.three}>3</span> to your iFood.
            </h1>
            <p className={styles.lede}>
              You pay three times for food: the food, the fees, and the difference to the cheapest option. The extension shows all three on every shop, product
              and bag, and takes you to the item worth buying.
            </p>
            <div className={styles.download}>
              <a className={`btn ${styles.dl}`} href="/downloads/upay3food-extension.zip" download>
                Download the extension
              </a>
              <div className={styles.dlMeta}>
                <span className="num">{info ? `v${info.version} · ${(info.sizeBytes / 1024).toFixed(0)} KB` : "development build"}</span>
                <span>Chrome · Edge · Brave · desktop</span>
                {info && (
                  <span className="num" title={info.sha256}>
                    SHA-256 {info.sha256.slice(0, 12)}…{info.commit ? ` · ${info.commit}` : ""}
                  </span>
                )}
              </div>
            </div>
            <div className={styles.onPhone}>
              <strong>On your phone?</strong>
              <p>
                The extension runs in a desktop browser. On a phone you can already send a screenshot of the menu to Claude with the UPAY3FOOD
                connector: Claude reads the items and UPAY3FOOD does the math per litre and per gram. The link to the item opens straight in the iFood app.
              </p>
              <Link href="/agentes">Plug it into Claude or ChatGPT →</Link>
            </div>
            <p className={styles.enLine}>The extension’s interface is in Portuguese, for Brazilian iFood users.</p>
          </div>
          <div className={styles.window} aria-hidden="true">
            <div className={styles.windowBar}>
              <i /><i /><i />
              <span className="num">ifood.com.br</span>
            </div>
            <div className={styles.windowBody}>
              <div className={styles.fakePage}>
                <span /><span /><span /><span />
              </div>
              <img className={styles.popup} src="/instalar/raio-x.png" width={380} height={666} alt="" />
            </div>
          </div>
        </div>
      </section>

      <section className={`wrap ${styles.stepsWrap}`}>
        <span className="eyebrow">In 2 minutes</span>
        <h2 className={`display ${styles.h2}`}>How to install</h2>
        <ol className={styles.steps}>
          {STEPS.map((s, i) => (
            <li key={s.t} className={styles.step}>
              <span className={`num ${styles.n}`}>{String(i + 1).padStart(2, "0")}</span>
              <strong>{s.t}</strong>
              <p className="muted">{s.d}</p>
              <StepVisual kind={s.visual} />
            </li>
          ))}
        </ol>
        <p className="muted small">
          Not on the Chrome Web Store yet, so it installs through developer mode. On a phone, see the <Link href="/docs/04-product/mobile">mobile plan</Link>. Have an agent (Claude, ChatGPT)? <Link href="/agentes">Plug UPAY3FOOD into it</Link>.
        </p>
      </section>

      <section className={styles.views}>
        <div className="wrap">
          <span className="eyebrow">Real screens · Maranata Açaí, São Paulo · 2026-10-10</span>
          <h2 className={`display ${styles.h2}`}>What you see</h2>
          <div className={styles.viewRow}>
            {VIEWS.map((v) => (
              <figure key={v.t} className={styles.view}>
                <img src={v.img} width={v.w / 2} height={v.h / 2} alt={`${v.t}: ${v.d}`} loading="lazy" />
                <figcaption>
                  <strong>{v.t}</strong>
                  <span className="muted">{v.d}</span>
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="muted small">Menu prices are estimates until the bag confirms them. The numbers follow a <Link href="/docs/05-architecture/price-calculations">public methodology</Link>.</p>
        </div>
      </section>

      <section className={`wrap ${styles.never}`}>
        <h2 className={`display ${styles.h2}`}>What it never does</h2>
        <ul>
          <li><b>×</b> Read passwords, cookies, tokens or login data.</li>
          <li><b>×</b> Click “Fazer pedido” (place order) or pay on its own.</li>
          <li><b>×</b> Use private APIs or intercept iFood’s network traffic.</li>
          <li><b>×</b> Send your address, name, phone or CPF.</li>
          <li><b>✓</b> Reads only what is already on your screen, in your session.</li>
        </ul>
      </section>
    </div>
  );
}
