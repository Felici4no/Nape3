import { formatBRL, priceLayers, unitInsights, type Cents } from "@nape3/domain";
import type { CartSnapshot, PageSnapshot } from "../shared/types";

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
  unit: { title: string | null; priceCents: number; originalPriceCents?: number | null };
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
      unit: { title: product.title.value, priceCents: product.unitPriceCents.value, originalPriceCents: product.originalUnitPriceCents.value }
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
