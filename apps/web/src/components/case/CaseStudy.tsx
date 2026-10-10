import Link from "next/link";
import data from "@/generated/case-study.json";
import { itemCost, readMenuFromText } from "@/lib/agent-tools";
import styles from "./CaseStudy.module.css";

const brl = (v: number) => `R$${v.toFixed(2)}`;
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
          Real shop · {data.shop}, {data.city} · {data.observedOn}
        </span>
        <h2 id="case-title" className={`display ${styles.h2}`}>One menu, {read.items_read} items, one calculation.</h2>
        <p className={styles.lede}>
          The extension read this shop’s menu as it appears on screen, without login. The same engine that runs in the extension and the MCP server
          computes the numbers below, live, every time this page loads.
        </p>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span className={`num ${styles.big}`}>+{extraPct}%</span>
          <span>more per litre for the dearest açaí than for the cheapest, in the same shop.</span>
        </div>
        <div className={styles.stat}>
          <span className={`num ${styles.big}`}>{cost.fees_as_product_ml ?? "—"} ml</span>
          <span>
            of the 700 ml bowl is what the fees ({brl(fees)}) are worth. You pay for açaí that never arrives.
          </span>
        </div>
        <div className={styles.stat}>
          <span className={`num ${styles.big}`}>{read.items_read}</span>
          <span>items read from the page: price, struck-through price, size and servings.</span>
        </div>
      </div>

      <figure className={styles.chart}>
        <figcaption className={styles.chartHead}>
          <strong>Price per litre, same shop</strong>
          <span className="muted small">Items with the same size and price grouped · menu price, before fees</span>
        </figcaption>
        <ol className={styles.bars}>
          {rows.map((r, i) => (
            <li key={`${r.ml}-${r.price}`} className={i === 0 ? styles.best : undefined} title={`${r.example} · ${brl(r.price)}`}>
              <span className={styles.label}>
                <strong>{r.ml} ml · {brl(r.price)}{i === 0 && <em className={styles.tag}>best per litre</em>}</strong>
                <span className="muted">{r.count > 1 ? `${r.count} options, e.g. ` : ""}{r.example}</span>
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
        Source: the page text, sanitized and versioned in <code>{data.source}</code>. Menu prices are estimates until the bag confirms them.{" "}
        <Link href="/transparencia">How we prove the rule doesn’t change →</Link>
      </p>
    </section>
  );
}
