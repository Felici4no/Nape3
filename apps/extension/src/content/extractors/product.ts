import type { ProductSnapshot } from "../../shared/types";
import { amountsIn, field, findByOwnText, isVisible, missing, textOf } from "../dom";

/**
 * Product = the open product dialog. Everything is scoped to the dialog so
 * prices of other menu items on the page are never read.
 */
export function extractProduct(doc: Document): ProductSnapshot {
  const dialog = Array.from(doc.querySelectorAll('[role="dialog"], [aria-modal="true"]')).find(isVisible);
  if (!dialog) {
    return {
      title: missing("no open product dialog"),
      unitPriceCents: missing("no open product dialog"),
      originalUnitPriceCents: missing("no open product dialog")
    };
  }

  const heading = dialog.querySelector("h1, h2, h3, [role='heading']");
  const title = heading ? field(textOf(heading), "high", "dialog heading") : missing<string>("dialog has no heading");

  // Preferred: the amount on the "Adicionar R$ xx,xx" button (price × chosen quantity/options).
  const addButton = findByOwnText(dialog, /^adicionar\b/i)
    .map((el) => el.closest("button") ?? el)
    .find((el) => amountsIn(el).length > 0);
  const amounts = amountsIn(dialog);
  const current = amounts.filter((a) => !a.struck);
  const struck = amounts.filter((a) => a.struck);

  let unitPriceCents: ProductSnapshot["unitPriceCents"];
  if (heading) {
    // Price displayed next to the heading (before options/add-ons).
    const nearHeading = amountsIn(heading.parentElement ?? dialog).filter((a) => !a.struck);
    unitPriceCents = nearHeading[0]
      ? field(nearHeading[0].cents, "high", `"${nearHeading[0].text}" next to heading`)
      : current[0]
        ? field(current[0].cents, "low", `"${current[0].text}" in dialog`)
        : missing("no price in dialog");
  } else {
    unitPriceCents = missing("no heading to anchor the price");
  }
  if (addButton && unitPriceCents.confidence !== "high") {
    const value = amountsIn(addButton)[0]!;
    unitPriceCents = field(value.cents, "medium", `add button "${textOf(addButton)}" (includes selected options)`);
  }

  return {
    title,
    unitPriceCents,
    originalUnitPriceCents: struck[0] ? field(struck[0].cents, "high", `struck "${struck[0].text}"`) : missing("no struck price")
  };
}
