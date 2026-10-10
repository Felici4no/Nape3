import type { MenuAdvice, MenuCandidate } from "@nape3/agent";
import { comboPremiums, costInsights, formatBRL, liquidValue, menuValue, priceLayers, readBurger, unitInsights, type Cents } from "@nape3/domain";
import type { CartSnapshot, MenuCard, PageSnapshot } from "../shared/types";

const brl = (cents: number) => formatBRL(cents as Cents);
const pct = (value: number) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/**
 * "Você paga 3 vezes pela comida": the food, the fees, and what is paid above
 * the cheapest comparable observation. On a product page the total is an
 * estimate (the bag decides); in the bag/checkout every number is read.
 */
export function PriceCard({ snapshot, cheapestComparableCents }: { snapshot: PageSnapshot; cheapestComparableCents: number | null }) {
  const input = fromSnapshot(snapshot);
  if (!input) return null;
  const layers = priceLayers({ ...input.layers, cheapestComparableCents });
  const unit = unitInsights(input.unit);
  const parts = [
    { key: "food", value: layers.foodCents },
    { key: "fees", value: layers.feesCents },
    { key: "over", value: layers.overpayCents ?? 0 }
  ];
  const sum = parts.reduce((total, part) => total + part.value, 0) || 1;
  const notes = [
    input.layers.deliveryFeeCents === null ? "frete confirmado na sacola" : null,
    input.layers.serviceFeeCents === null ? "taxa de serviço estimada em R$0,99 por pedido (iFood)" : null,
    layers.notes.includes("observed total differs from the sum of its parts") ? "o total não bate com a soma das partes" : null,
    input.layers.totalCents == null && input.layers.deliveryFeeCents !== null ? "frete do card da loja; pode mudar na sacola" : null
  ].filter((note): note is string => note !== null);

  return (
    <section className="price-card">
      <div className="price-card__top">
        <span className="eyebrow">Você paga 3 vezes</span>
        {layers.estimated ? <span className="chip chip--warn">estimativa</span> : <span className="chip chip--ok">lido da página</span>}
      </div>
      <div className="price-card__total">
        <span className="display num">{brl(layers.totalCents)}</span>
        <span className="muted small">{input.label}</span>
      </div>

      <div className="bar" role="img" aria-label={`Comida ${brl(layers.foodCents)}, taxas ${brl(layers.feesCents)}`}>
        {parts.map((part) => (part.value > 0 ? <i key={part.key} className={`bar__${part.key}`} style={{ flexGrow: part.value / sum }} /> : null))}
      </div>

      <ol className="layers">
        <li>
          <span className="dot dot--food" />
          <span>Comida</span>
          <span className="num">{brl(layers.foodCents)}</span>
        </li>
        <li>
          <span className="dot dot--fees" />
          <span>
            Taxas
            <small className="muted">
              {" "}entrega {input.layers.deliveryFeeCents === null ? "na sacola" : brl(layers.deliveryFeeCents)} · serviço {brl(layers.serviceFeeCents)}
              {input.layers.serviceFeeCents === null ? " (est.)" : ""}
            </small>
          </span>
          <span className="num">{brl(layers.feesCents)}</span>
        </li>
        <li>
          <span className="dot dot--over" />
          <span>
            Diferença
            <small className="muted"> {layers.overpayCents === null ? "sem comparação ainda" : "acima do mais barato observado"}</small>
          </span>
          <span className="num">{layers.overpayCents === null ? "—" : brl(layers.overpayCents)}</span>
        </li>
      </ol>

      <div className="metrics">
        <Metric label="taxas no total" value={pct(layers.feeSharePct)} />
        <Metric label="por 100 ml" value={unit.pricePer100mlCents === null ? "—" : brl(unit.pricePer100mlCents)} />
        <Metric label="desconto exibido" value={unit.discountPct === null ? "—" : `−${pct(unit.discountPct)}`} tone={unit.discountPct ? "ok" : undefined} />
      </div>
      {layers.discountCents > 0 && <p className="muted small">Inclui {brl(layers.discountCents)} de desconto na sacola.</p>}
      {notes.length > 0 && <p className="muted small">{notes.join(" · ")}</p>}
    </section>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "ok" | undefined }) {
  return (
    <div className={`metric${tone ? ` metric--${tone}` : ""}`}>
      <span className="num">{value}</span>
      <span className="muted">{label}</span>
    </div>
  );
}

type CardInput = {
  label: string;
  layers: { foodCents: number; deliveryFeeCents: number | null; serviceFeeCents: number | null; discountCents?: number | null; totalCents?: number | null };
  unit: { title: string | null; priceCents: number; originalPriceCents?: number | null; servingsText?: string | null };
};

function fromSnapshot(snapshot: PageSnapshot): CardInput | null {
  const cart = snapshot.cart;
  if (cart && cart.validity.valid && cart.itemsSubtotalCents.value !== null) return fromCart(cart);
  const product = snapshot.product;
  if (product?.unitPriceCents.value != null) {
    return {
      label: "estimativa até a sacola",
      layers: {
        foodCents: product.unitPriceCents.value,
        deliveryFeeCents: product.deliveryFeeCents?.value ?? null,
        serviceFeeCents: null
      },
      unit: {
        title: product.title.value,
        priceCents: product.unitPriceCents.value,
        originalPriceCents: product.originalUnitPriceCents.value,
        servingsText: product.servingsText ?? null
      }
    };
  }
  return null;
}

function fromCart(cart: CartSnapshot): CardInput {
  const single = cart.lines.length === 1 ? cart.lines[0]! : null;
  return {
    label: "total do checkout",
    layers: {
      foodCents: cart.itemsSubtotalCents.value!,
      deliveryFeeCents: cart.deliveryFeeCents.value,
      serviceFeeCents: cart.serviceFeeCents.value,
      discountCents: cart.discountCents.value,
      totalCents: cart.totalCents.value
    },
    // Per-100 ml only when the bag has one line (one product, known quantity).
    unit: single
      ? { title: single.sourceTitle, priceCents: Math.round(single.lineTotalCents / Math.max(1, single.quantity)) }
      : { title: null, priceCents: cart.itemsSubtotalCents.value! }
  };
}

const ml = (value: number) => `${value.toLocaleString("pt-BR")} ml`;

/**
 * "Raio-X do preço": the same product seen as the market compares it — per
 * 100 ml, per litre, per 100 g, per person, the real per-100 ml with the fees,
 * and the fees converted into product. One sentence per view; only views
 * with data are shown.
 */
export function CostXray({ snapshot }: { snapshot: PageSnapshot }) {
  const input = fromSnapshot(snapshot);
  if (!input || !input.unit.title) return null;
  const layers = priceLayers(input.layers);
  const c = costInsights({ ...input.unit, feesCents: layers.feesCents });
  const rows: Array<{ k: string; value: string; text: string }> = [];
  if (c.pricePer100mlCents !== null) {
    rows.push({
      k: "100ml",
      value: brl(c.pricePer100mlCents),
      text:
        c.effectivePer100mlCents !== null && c.effectivePer100mlCents !== c.pricePer100mlCents
          ? `cada 100 ml no cardápio · com as taxas, ${brl(c.effectivePer100mlCents)}`
          : "cada 100 ml"
    });
  }
  if (c.pricePerLiterCents !== null) rows.push({ k: "litro", value: brl(c.pricePerLiterCents), text: "o litro, para comparar com outros tamanhos" });
  if (c.pricePer100gCents !== null) rows.push({ k: "100g", value: brl(c.pricePer100gCents), text: "cada 100 g" });
  if (c.feesAsProductMl !== null && layers.feesCents > 0) {
    rows.push({ k: "fees-ml", value: ml(c.feesAsProductMl), text: `é o que as taxas (${brl(layers.feesCents)}) valem deste produto` });
  } else if (c.feesAsProductG !== null && layers.feesCents > 0) {
    rows.push({ k: "fees-g", value: `${c.feesAsProductG} g`, text: `é o que as taxas (${brl(layers.feesCents)}) valem deste produto` });
  }
  if (c.totalPerServingCents !== null) {
    rows.push({ k: "pessoa", value: brl(c.totalPerServingCents), text: `por pessoa com taxas (serve ${c.servings})` });
  }
  if (c.discountPct !== null && c.discountCents !== null) {
    rows.push({ k: "desconto", value: `−${pct(c.discountPct)}`, text: `${brl(c.discountCents)} abaixo do preço riscado, informado pela loja` });
  }
  if (rows.length === 0) return null;
  return (
    <section className="xray">
      <span className="eyebrow">Raio-X do preço</span>
      <ul>
        {rows.map((row) => (
          <li key={row.k}>
            <span className="num">{row.value}</span>
            <span>{row.text}</span>
          </li>
        ))}
      </ul>
      {layers.estimated && <p className="muted small">Com taxas estimadas até a sacola.</p>}
    </section>
  );
}

/**
 * "Tamanho que compensa": the shop's menu ranked by price per 100 ml (açaí)
 * or per 100 g of meat (burgers), plus what each combo charges for its extras.
 */
export function MenuValueCard({ menu }: { menu: readonly MenuCard[] }) {
  const acai = menu.filter((item) => /a[cç]a[ií]/i.test(item.title));
  const burgers = menu.filter((item) => readBurger(item.title).meatGrams !== null || readBurger(item.title).isCombo);
  const meat = acai.length < 2 && burgers.length >= 2;
  const value = meat ? menuValue(burgers, "meat") : menuValue(acai, "volume");
  const combos = meat ? comboPremiums(burgers) : [];
  if ((!value.best || !value.worst || value.ranked.length < 2) && combos.length === 0) return null;
  const unit = meat ? "100 g de carne" : "100 ml";
  return (
    <section className="xray">
      <span className="eyebrow">Tamanho que compensa</span>
      {value.best && value.worst && value.ranked.length >= 2 && (
        <>
          <p className="small">
            Nesta loja, o melhor custo sai <strong>{pct(value.spreadPct ?? 0)} mais barato</strong> por {unit} que o pior.
          </p>
          <ul>
            {value.ranked.slice(0, 3).map((item, index) => {
              const b = meat ? readBurger(item.title) : null;
              return (
                <li key={`${item.title}|${item.priceCents}`}>
                  <span className="num">{brl(item.pricePer100mlCents)}</span>
                  <span>
                    {index === 0 ? "★ " : ""}
                    {item.title}{" "}
                    <small className="muted">
                      · {brl(item.priceCents)}
                      {b ? ` · ${b.meatGrams} g${b.meatType ? ` ${b.meatType}` : ""}${b.patties > 1 ? ` (${b.patties} carnes)` : ""}` : ""}
                    </small>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {!meat && value.bulkBest && (
        <p className="muted small">
          Potes à parte: {value.bulkBest.title} sai <span className="num">{brl(value.bulkBest.pricePer100mlCents * 10)}/L</span> (outra compra).
        </p>
      )}
      {combos.slice(0, 2).map((combo) => (
        <p className="small" key={combo.combo}>
          No combo, {combo.extras.length ? combo.extras.join(" + ") : "os extras"} custam <strong className="num">{brl(combo.extrasCents)}</strong> a mais que o lanche sozinho.
        </p>
      ))}
      <p className="muted small">
        {value.ranked.length} itens com {meat ? "gramas de carne" : "tamanho em ml"}
        {value.unranked ? ` · ${value.unranked} sem medida ficaram de fora` : ""} · preço do cardápio, sem taxas.
      </p>
    </section>
  );
}

const per = (c: MenuCandidate) => (c.unit === "ml" ? `${brl(c.pricePer100Cents! * 10)}/L` : `${brl(c.pricePer100Cents!)}/100 g`);

function CandidateBlock({ c, lead }: { c: MenuCandidate; lead?: string }) {
  return (
    <div className="advice__best">
      {lead && <span className="eyebrow">{lead}</span>}
      <span className="display num">{brl(c.estimatedTotalCents!)}</span>
      <span className="small">
        <strong>{c.title}</strong> · {c.merchantName}
      </span>
      <span className="muted small">
        {brl(c.priceCents)}
        {c.quantity > 1 ? ` × ${c.quantity}` : ""} + frete {brl(c.deliveryFeeCents ?? 0)} + serviço {brl(c.serviceFeeCents)}
        {c.pricePer100Cents ? ` · ${per(c)}` : ""}
      </span>
      {(c.itemUrl ?? c.merchantPath) && (
        <a className="advice__link" href={c.itemUrl ?? `https://www.ifood.com.br${c.merchantPath}`} target="_blank" rel="noreferrer">
          {c.itemUrl ? "Abrir este item no iFood →" : "Abrir a loja no iFood →"}
        </a>
      )}
    </div>
  );
}

/** "Pesquisa no cardápio": the agent's answer from the menus already read — estimates, never offers. */
export function MenuAdvicePanel({ advice }: { advice: MenuAdvice }) {
  if (advice.itemsConsidered === 0) {
    return (
      <section className="xray">
        <span className="eyebrow">Pesquisa no cardápio</span>
        <p className="small">Abra a página de algumas lojas no iFood: o cardápio de cada uma entra na pesquisa.</p>
      </section>
    );
  }
  const { bestForRequest: best, bestValue: value, nearest, bulkBest } = advice;
  return (
    <section className="xray advice">
      <div className="price-card__top">
        <span className="eyebrow">Pesquisa no cardápio · {advice.shopsConsidered} loja{advice.shopsConsidered === 1 ? "" : "s"}</span>
        <span className="chip chip--warn">estimativa</span>
      </div>
      {best ? (
        <CandidateBlock c={best} />
      ) : nearest ? (
        <>
          <p className="small">Nada no tamanho pedido cabe no orçamento. O tamanho mais próximo que cabe:</p>
          <CandidateBlock c={nearest} />
        </>
      ) : (
        <p className="small">Nada no tamanho e no orçamento pedidos entre as lojas lidas.</p>
      )}
      {value && value !== best && value !== nearest && (
        <p className="small">
          Melhor custo por {value.unit === "ml" ? "litro" : "100 g de carne"}: <strong>{value.title}</strong> em {value.merchantName} · <span className="num">{per(value)}</span>
          {advice.bestValueOverBudget ? <span className="muted"> · passa do orçamento no total</span> : null}
        </p>
      )}
      {bulkBest && (
        <p className="muted small">
          Para estocar: {bulkBest.title} em {bulkBest.merchantName} sai <span className="num">{per(bulkBest)}</span> (pote é outra compra; fica fora da comparação).
        </p>
      )}
      <details>
        <summary>Como o agente chegou nisso</summary>
        <ul className="reasons">
          {advice.reasoning.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
      <p className="muted small">Preços do cardápio com o frete mostrado na loja. Cupons, Clube e endereço podem mudar o valor: confirme na sacola.</p>
    </section>
  );
}

/** "Bebidas por litro": every drink on the menu priced per litre, compared only within its kind. */
export function DrinksPerLiterCard({ menu }: { menu: readonly MenuCard[] }) {
  const groups = liquidValue(menu).filter((g) => g.kind !== "acai" && g.ranked.length >= 2);
  if (groups.length === 0) return null;
  return (
    <section className="xray">
      <span className="eyebrow">Bebidas por litro</span>
      <ul>
        {groups.slice(0, 4).map((g) => {
          const best = g.ranked[0]!;
          return (
            <li key={g.kind}>
              <span className="num">{brl(best.pricePerLiterCents)}/L</span>
              <span>
                <strong>{g.label}:</strong> {best.title}
                <small className="muted">
                  {best.units > 1 ? ` · ${best.units} un = ${(best.totalMl / 1000).toLocaleString("pt-BR")} L` : ""} · {pct(g.spreadPct ?? 0)} mais barato por litro que o pior de {g.ranked.length}
                </small>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="muted small">Cada tipo só é comparado com o próprio tipo. Packs contam todas as unidades.</p>
    </section>
  );
}
