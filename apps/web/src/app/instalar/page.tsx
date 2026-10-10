import Link from "next/link";
import packed from "@/generated/extension-info.json";
import styles from "./instalar.module.css";

export const metadata = {
  title: "Instalar a extensão",
  description: "Você paga 3 vezes pela comida. A extensão UPAY3FOOD mostra as três e te leva ao mais barato."
};

type ExtensionInfo = { version: string; sizeBytes: number; sha256: string; builtAt: string; commit: string | null };

function extensionInfo(): ExtensionInfo | null {
  const info = packed as unknown as { version: string | null } & Omit<ExtensionInfo, "version">;
  return info.version ? (info as ExtensionInfo) : null;
}

const STEPS = [
  { t: "Baixe e extraia", d: "Baixe o .zip e extraia numa pasta que você não vai apagar, por exemplo Documentos/upay3food.", visual: "zip" },
  { t: "Ligue o modo do desenvolvedor", d: "No Chrome, Edge ou Brave, abra chrome://extensions e ligue a chave no canto superior direito.", visual: "toggle" },
  { t: "Carregue a pasta", d: "Clique em “Carregar sem compactação” e escolha a pasta que tem o manifest.json.", visual: "load" },
  { t: "Abra o iFood", d: "Fixe o ícone na barra, entre em ifood.com.br e abra uma loja. Não precisa estar logado.", visual: "ifood" }
] as const;

const VIEWS = [
  { img: "/instalar/raio-x.png", w: 760, h: 1332, t: "No produto", d: "As três camadas do preço e o Raio-X: por 100 ml, por litro, por pessoa, e quanto as taxas valem do próprio produto." },
  { img: "/instalar/tamanho.png", w: 760, h: 626, t: "Na loja", d: "O cardápio inteiro ordenado por preço por 100 ml (ou por 100 g de carne). Potes e bebidas ficam em comparações próprias." },
  { img: "/instalar/sacola.png", w: 760, h: 1240, t: "Na sacola", d: "Cada número vem da página e é conferido contra o total: subtotal, frete, serviço e desconto." }
];

function StepVisual({ kind }: { kind: (typeof STEPS)[number]["visual"] }) {
  if (kind === "zip") return <div className={styles.vZip}><span>upay3food-extension.zip</span><b>↓</b></div>;
  if (kind === "toggle")
    return (
      <div className={styles.vBar}>
        <span className="num">chrome://extensions</span>
        <span className={styles.vToggle}>Modo do desenvolvedor <i /></span>
      </div>
    );
  if (kind === "load") return <div className={styles.vBtns}><span className={styles.vBtnOn}>Carregar sem compactação</span><span>Compactar</span></div>;
  return <div className={styles.vBar}><span className="num">ifood.com.br/delivery/…</span><span className={styles.vBadge}>U3</span></div>;
}

export default function Instalar() {
  const info = extensionInfo();
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={`wrap ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <span className={styles.kicker}>Instalar · extensão para navegador</span>
            <h1 className={`display ${styles.title}`}>
              Leve o <span className={styles.three}>3</span> para o seu iFood.
            </h1>
            <p className={styles.lede}>
              Você paga 3 vezes pela comida: a comida, as taxas e a diferença para a opção mais barata. A extensão mostra as três em cada loja, produto e sacola,
              e te leva ao item que compensa.
            </p>
            <div className={styles.download}>
              <a className={`btn ${styles.dl}`} href="/downloads/upay3food-extension.zip" download>
                Baixar a extensão
              </a>
              <div className={styles.dlMeta}>
                <span className="num">{info ? `v${info.version} · ${(info.sizeBytes / 1024).toFixed(0)} KB` : "versão de desenvolvimento"}</span>
                <span>Chrome · Edge · Brave · computador</span>
                {info && (
                  <span className="num" title={info.sha256}>
                    SHA-256 {info.sha256.slice(0, 12)}…{info.commit ? ` · ${info.commit}` : ""}
                  </span>
                )}
              </div>
            </div>
            <p className={styles.enLine}>English: a browser extension that shows the food, the fees and the difference on every iFood page.</p>
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
        <span className="eyebrow">Em 2 minutos</span>
        <h2 className={`display ${styles.h2}`}>Como instalar</h2>
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
          Ainda não está na Chrome Web Store, por isso a instalação é pelo modo do desenvolvedor. No celular: veja o <Link href="/docs/04-product/mobile">plano para mobile</Link>. Tem um agente (Claude, ChatGPT)? <Link href="/agentes">Plugue o UPAY3FOOD nele</Link>.
        </p>
      </section>

      <section className={styles.views}>
        <div className="wrap">
          <span className="eyebrow">Telas reais · Maranata Açaí, São Paulo · 10/10/2026</span>
          <h2 className={`display ${styles.h2}`}>O que aparece</h2>
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
          <p className="muted small">Preços do cardápio são estimativas até a sacola. Os números seguem uma <Link href="/docs/05-architecture/price-calculations">metodologia pública</Link>.</p>
        </div>
      </section>

      <section className={`wrap ${styles.never}`}>
        <h2 className={`display ${styles.h2}`}>O que ela nunca faz</h2>
        <ul>
          <li><b>×</b> Ler senha, cookie, token ou dados de login.</li>
          <li><b>×</b> Clicar em “Fazer pedido” ou pagar sozinha.</li>
          <li><b>×</b> Usar APIs privadas ou interceptar a rede do iFood.</li>
          <li><b>×</b> Enviar seu endereço, nome, telefone ou CPF.</li>
          <li><b>✓</b> Só lê o que já está na sua tela, na sua sessão.</li>
        </ul>
      </section>
    </div>
  );
}
