import Link from "next/link";
import info from "@/generated/transparency.json";
import anchors from "@/data/anchors.json";
import { AnchorPanel } from "./AnchorPanel";
import styles from "./transparencia.module.css";

export const metadata = {
  title: "Transparência",
  description: "A metodologia e o código dos cálculos do UPAY3FOOD, com o hash registrado na Solana mainnet. Qualquer pessoa pode verificar."
};

export type Anchor = { signature: string; slot: number | null; signer: string; methodologySha256: string; engineSha256: string; commit: string | null; anchoredAt: string };

export default function Transparencia() {
  const list = anchors as Anchor[];
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className="wrap">
          <span className={styles.kicker}>Solana mainnet · SPL Memo · verificável por qualquer pessoa</span>
          <h1 className={`display ${styles.title}`}>Os números não mudam depois.</h1>
          <p className={styles.lede}>
            Cada versão da metodologia e do código que calcula o preço por litro, as 3 camadas e a recomendação vira um hash SHA-256. Esse hash é registrado
            na Solana. Se alguém alterar a regra depois, o hash não bate mais.
          </p>
        </div>
      </section>

      <section className="wrap">
        <h2 className={`display ${styles.h2}`}>Esta versão</h2>
        <dl className={styles.hashes}>
          <div>
            <dt>Metodologia</dt>
            <dd>
              <Link href="/docs/05-architecture/price-calculations">{info.methodologyFile}</Link>
              <code className="num">{info.methodologySha256}</code>
            </dd>
          </div>
          <div>
            <dt>Código dos cálculos</dt>
            <dd>
              <span className="muted small">{info.engineFiles.join(" + ")}</span>
              <code className="num">{info.engineSha256}</code>
            </dd>
          </div>
          <div>
            <dt>Commit</dt>
            <dd>
              <code className="num">{info.commit ?? "—"}</code>
            </dd>
          </div>
        </dl>
        <pre className={styles.cmd}><code>{`# confira você mesmo, no repositório
sha256sum ${info.methodologyFile}
cat ${info.engineFiles.join(" ")} | sha256sum`}</code></pre>
      </section>

      <section className="wrap">
        <h2 className={`display ${styles.h2}`}>Registros na Solana</h2>
        <AnchorPanel current={{ methodologySha256: info.methodologySha256, engineSha256: info.engineSha256, commit: info.commit }} anchors={list} />
      </section>

      <section className={`wrap ${styles.why}`}>
        <h2 className={`display ${styles.h2}`}>Por que isso importa</h2>
        <ul>
          <li><b>Para quem usa:</b> a regra que diz “o 700 ml sai mais barato por litro” é pública e não muda escondida.</li>
          <li><b>Para as plataformas:</b> comparação com critério objetivo e publicado — o que faltou no caso Taxômetro (99Food, 2026).</li>
          <li><b>Para reguladores e pesquisa:</b> índices futuros de preço de delivery poderão ser verificados lote a lote, do mesmo jeito.</li>
        </ul>
        <p className="muted small">O registro guarda só hashes. Nenhum preço de usuário, endereço ou dado pessoal vai para a blockchain.</p>
      </section>
    </div>
  );
}
