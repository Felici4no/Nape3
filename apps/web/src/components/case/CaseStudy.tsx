import Link from "next/link";
import data from "@/generated/case-study.json";
import { itemCost, readMenuFromText } from "@/lib/agent-tools";
import styles from "./CaseStudy.module.css";

const brl = (v: number) => `R$${v.toFixed(2).replace(".", ",")}`;
const IFOOD_SERVICE_FEE_BRL = 0.99;

type Row = { ml: number; price: number; perLiter: number; count: number; example: string };

/**
 * One real shop, computed live from its sanitized menu text by the same
 * engine the extension and the MCP server use. Nothing here is typed by hand.
 */
export function CaseStudy() {
  const read = readMenuFromText({ text: data.text, shop_name: data.shop, shop_url: data.shopUrl });
  const ranked = read.summary && "ranked" in read.summary ? read.summary.ranked : undefined;
  if (!ranked || ranked.length < 2) return null;

  // Same size and price → one row (the menu repeats combos with different toppings).
  const rows: Row[] = [];
  for (const r of ranked) {
    const perLiter = Math.round(r.price_per_100_brl! * 1000) / 100;
    const same = rows.find((x) => x.ml === r.amount && x.price === r.price_brl);
    if (same) same.count += 1;
    else rows.push({ ml: r.amount, price: r.price_brl!, perLiter, count: 1, example: r.title.replace(/^[*.]\s*/, "") });
  }
  const best = rows[0]!;
  const worst = rows[rows.length - 1]!;
  const max = worst.perLiter;
  const extraPct = Math.round(((worst.perLiter - best.perLiter) / best.perLiter) * 100);

  const fees = (read.menu.delivery_fee_brl ?? 0) + IFOOD_SERVICE_FEE_BRL;
  const marmitex = ranked.find((r) => r.amount === 700 && !/hits/i.test(r.title)) ?? ranked[0]!;
  const cost = itemCost({ title: marmitex.title, price_brl: marmitex.price_brl!, fees_brl: fees });

  return (
    <section className={`wrap ${styles.case}`} aria-labelledby="case-title">
      <div className={styles.head}>
        <span className="eyebrow">
          Loja real · {data.shop}, {data.city} · {data.observedOn.split("-").reverse().join("/")}
        </span>
        <h2 id="case-title" className={`display ${styles.h2}`}>Um cardápio, {read.items_read} itens, uma conta.</h2>
        <p className={styles.lede}>
          A extensão leu o cardápio desta loja como ele aparece na tela, sem login. O mesmo motor que roda na extensão e no MCP calcula os números
          abaixo, ao vivo, a cada carregamento desta página.
        </p>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={`num ${styles.big}`}>+{extraPct}%</span>
          <span>é quanto o litro mais caro custa a mais que o mais barato, no mesmo açaí.</span>
        </div>
        <div className={styles.stat}>
          <span className={`num ${styles.big}`}>{cost.fees_as_product_ml ?? "—"} ml</span>
          <span>
            é o que as taxas ({brl(fees)}) valem no Marmitex de 700 ml. Você paga por açaí que não vem.
          </span>
        </div>
        <div className={styles.stat}>
          <span className={`num ${styles.big}`}>{read.items_read}</span>
          <span>itens lidos da página: preço, preço riscado, tamanho e porções.</span>
        </div>
      </div>

      <figure className={styles.chart}>
        <figcaption className={styles.chartHead}>
          <strong>Preço por litro, mesma loja</strong>
          <span className="muted small">Itens de mesmo tamanho e preço agrupados · preço do cardápio, sem taxas</span>
        </figcaption>
        <ol className={styles.bars}>
          {rows.map((r, i) => (
            <li key={`${r.ml}-${r.price}`} className={i === 0 ? styles.best : undefined} title={`${r.example} · ${brl(r.price)}`}>
              <span className={styles.label}>
                <strong>{r.ml} ml · {brl(r.price)}{i === 0 && <em className={styles.tag}>melhor por litro</em>}</strong>
                <span className="muted">{r.count > 1 ? `${r.count} opções, ex.: ` : ""}{r.example}</span>
              </span>
              <span className={styles.track} aria-hidden="true">
                <i style={{ width: `${(r.perLiter / max) * 100}%` }} />
              </span>
              <span className={`num ${styles.value}`}>
                {brl(r.perLiter)}/L
              </span>
            </li>
          ))}
        </ol>
      </figure>

      <p className="muted small">
        Fonte: texto da página, sanitizado e versionado em <code>{data.source}</code>. Preços do cardápio são estimativas até a sacola.{" "}
        <Link href="/transparencia">Como garantimos que a regra não muda →</Link>
      </p>
    </section>
  );
}
