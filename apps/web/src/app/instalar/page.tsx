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
  { t: "Baixe o arquivo", d: "Clique em “Baixar a extensão” e extraia o .zip numa pasta que você não vai apagar (ex.: Documentos/upay3food)." },
  { t: "Abra as extensões", d: "No Chrome, Edge ou Brave, abra chrome://extensions e ligue o Modo do desenvolvedor, no canto superior direito." },
  { t: "Carregue a pasta", d: "Clique em “Carregar sem compactação” e escolha a pasta extraída (a que tem o manifest.json)." },
  { t: "Fixe o ícone", d: "No ícone de quebra-cabeça da barra, fixe a UPAY3FOOD para abrir com um clique." },
  { t: "Abra o iFood", d: "Entre em ifood.com.br, abra algumas lojas e um produto. O popup mostra as três camadas do preço." }
];

const VIEWS = [
  { img: "/instalar/raio-x.png", t: "Você paga 3 vezes", d: "Comida, taxas e a diferença para o mais barato observado. Por 100 ml, por litro, por pessoa, e quanto as taxas valem do próprio produto." },
  { img: "/instalar/tamanho.png", t: "Tamanho que compensa", d: "O cardápio inteiro da loja, ordenado por preço por 100 ml (ou por 100 g de carne no hambúrguer). Potes ficam à parte." },
  { img: "/instalar/sacola.png", t: "Lido da sua sacola", d: "Na sacola, cada número vem da página: subtotal, frete, serviço e desconto, conferidos contra o total." }
];

export default function Instalar() {
  const info = extensionInfo();
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className="wrap">
          <span className="eyebrow">Extensão para navegador · grátis · código aberto</span>
          <h1 className={`display ${styles.title}`}>
            Você paga <span className={styles.three}>3</span> vezes pela comida.
          </h1>
          <p className={styles.lede}>
            A comida, as taxas e a diferença para a opção mais barata. A UPAY3FOOD mostra as três no iFood e te leva direto ao item que compensa.
          </p>
          <p className={`muted ${styles.en}`}>You pay three times for food: the food, the fees, and the difference. The extension shows all three.</p>
          <div className={styles.ctas}>
            <a className="btn" href="/downloads/upay3food-extension.zip" download>
              Baixar a extensão{info ? ` · v${info.version}` : ""}
            </a>
            <Link className="btn ghost" href="/docs/05-architecture/price-calculations">Como calculamos</Link>
          </div>
          {info && (
            <p className={`muted small ${styles.meta}`}>
              {(info.sizeBytes / 1024).toFixed(0)} KB · gerada em {new Date(info.builtAt).toLocaleDateString("pt-BR")}
              {info.commit ? ` · commit ${info.commit}` : ""} · SHA-256 <code>{info.sha256.slice(0, 16)}…</code>
            </p>
          )}
        </div>
      </section>

      <section className="wrap">
        <h2 className={`display ${styles.h2}`}>O que aparece</h2>
        <div className={styles.views}>
          {VIEWS.map((v) => (
            <figure key={v.t} className={styles.view}>
              <img src={v.img} alt={v.t} loading="lazy" />
              <figcaption>
                <strong>{v.t}</strong>
                <span className="muted">{v.d}</span>
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="muted small">Telas com dados reais de uma loja em São Paulo (10/10/2026). Preços do cardápio são estimativas até a sacola.</p>
      </section>

      <section className="wrap">
        <h2 className={`display ${styles.h2}`}>Instalar em 2 minutos</h2>
        <ol className={styles.steps}>
          {STEPS.map((s, i) => (
            <li key={s.t}>
              <span className={`num ${styles.n}`}>{i + 1}</span>
              <div>
                <strong>{s.t}</strong>
                <p className="muted">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="muted small">
          A extensão ainda não está na Chrome Web Store: por isso a instalação é pelo modo do desenvolvedor. Funciona em Chrome, Edge e Brave no computador.
          No celular, veja o <Link href="/docs/04-product/mobile">plano para mobile</Link>.
        </p>
      </section>

      <section className={styles.night}>
        <div className="wrap">
          <h2 className={`display ${styles.h2}`}>O que ela nunca faz</h2>
          <ul className={styles.promises}>
            <li>Não lê senha, cookie, token nem dados de login.</li>
            <li>Não clica em “Fazer pedido” nem paga nada sozinha.</li>
            <li>Não usa APIs privadas nem intercepta a rede do iFood.</li>
            <li>Não envia seu endereço, nome, telefone ou CPF.</li>
            <li>Só lê o que já está na sua tela, na sua própria sessão.</li>
          </ul>
          <p className={styles.nightNote}>
            Cardápios e observações ficam no seu navegador. Os números seguem uma <Link href="/docs/05-architecture/price-calculations">metodologia pública</Link>.
          </p>
        </div>
      </section>
    </div>
  );
}
