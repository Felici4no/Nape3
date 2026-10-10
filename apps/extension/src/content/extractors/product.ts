import type { ProductSnapshot } from "../../shared/types";
import { parseAllBRL } from "@nape3/domain";
import { amountsIn, clean, field, findByOwnText, isStruckThrough, isVisible, missing, ownText, textOf } from "../dom";

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
  // iFood's product modal (2026) has no heading: the name is in the modal's
  // nav-header title, repeated as the image alt text.
  const navTitle = Array.from(dialog.querySelectorAll('[class*="nav-header__title"], [class*="dish-name"]')).find((el) => textOf(el));
  const imageName = clean(dialog.querySelector('[class*="dish-content__img"] img, img[alt]')?.getAttribute("alt") ?? "");
  const title = heading
    ? field(textOf(heading), "high", "dialog heading")
    : navTitle
      ? field(textOf(navTitle), imageName && imageName === textOf(navTitle) ? "high" : "medium", "dialog nav-header title")
      : imageName
        ? field(imageName, "low", "product image alt text")
        : missing<string>("dialog has no heading or title");
  // The displayed item price (before options), when the modal marks it.
  const priceBox = dialog.querySelector('[class*="dish-price"]');

  // Preferred: the amount on the "Adicionar R$ xx,xx" button (price × chosen quantity/options).
  const addButton = findByOwnText(dialog, /^adicionar\b/i)
    .map((el) => el.closest("button") ?? el)
    .find((el) => amountsIn(el).length > 0);
  const amounts = amountsIn(dialog);
  const current = amounts.filter((a) => !a.struck);
  const struck = amounts.filter((a) => a.struck);

  let unitPriceCents: ProductSnapshot["unitPriceCents"];
  // The current price is the price box's own text; the struck original is nested inside it.
  const boxed = priceBox
    ? [priceBox, ...Array.from(priceBox.querySelectorAll("*"))]
        .filter((el) => isVisible(el) && !isStruckThrough(el))
        .flatMap((el) => parseAllBRL(ownText(el)).map((value) => ({ cents: value, text: clean(ownText(el)) })))
    : [];
  if (boxed[0]) {
    unitPriceCents = field(boxed[0].cents, "high", `"${boxed[0].text}" in the dish price`);
  } else if (heading) {
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
