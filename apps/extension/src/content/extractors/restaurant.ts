import { parseBRL } from "@nape3/domain";
import type { RestaurantSnapshot } from "../../shared/types";
import { amountForLabel, clean, field, findByOwnText, isVisible, missing, parseEta, textOf } from "../dom";

/** iFood document titles look like "<Merchant> - <Neighbourhood> ... | iFood" (assumption). */
function merchantFromTitle(title: string): string | null {
  const head = clean(title.split(/\s[|–-]\s/)[0]);
  return head && !/ifood/i.test(head) ? head : null;
}

export function extractRestaurant(doc: Document): RestaurantSnapshot {
  const root = doc.body;
  // On a restaurant page the single page-level <h1> is the merchant name.
  // We never fall back to "the first h2/h3".
  const h1s = Array.from(root.querySelectorAll("h1")).filter(isVisible);
  const fromTitle = merchantFromTitle(doc.title);
  const merchantName =
    h1s.length === 1
      ? field(textOf(h1s[0]!), fromTitle && textOf(h1s[0]!).includes(fromTitle) ? "high" : "medium", "page <h1>")
      : fromTitle
        ? field(fromTitle, "low", "document.title")
        : missing<string>(`ambiguous: ${h1s.length} visible <h1>`);

  const minimumOrderCents = (() => {
    const label = findByOwnText(root, /pedido m[ií]nimo/i)[0];
    const value = label ? parseBRL(textOf(label.parentElement ?? label)) : null;
    return value !== null ? field(value, "high", `"${textOf(label!.parentElement ?? label!)}"`) : missing<number>("pedido mínimo not found");
  })();

  const deliveryFeeCents = amountForLabel(root, /^(taxa de )?entrega$/i, [/pedido m[ií]nimo/i], { allowFree: true });

  const etaLabel = findByOwnText(root, /\d{1,3}\s*[-–]\s*\d{1,3}\s*min/i)[0];
  const eta = etaLabel ? parseEta(textOf(etaLabel)) : null;

  return {
    merchantName,
    deliveryFeeCents,
    minimumOrderCents: minimumOrderCents as RestaurantSnapshot["minimumOrderCents"],
    eta: eta ? field(eta, "medium", `"${textOf(etaLabel!)}"`) : missing("ETA not found")
  };
}
