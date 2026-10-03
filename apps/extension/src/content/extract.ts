import type { RawOffer } from "../shared/types";

const PRICE_RE = /R\$\s*([0-9]{1,4}(?:\.[0-9]{3})*,[0-9]{2})/;

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none"
  );
}

function parseBrlToCents(text: string): number | null {
  const match = text.match(PRICE_RE);
  if (!match) return null;

  const normalized = match[1].replace(/\./g, "").replace(",", ".");
  const amount = Number.parseFloat(normalized);

  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function findVisiblePrice(): number | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-testid*="price"], [data-test*="price"], [class*="price" i], span, p'
    )
  );

  for (const element of candidates) {
    if (!isVisible(element)) continue;

    const text = element.innerText?.trim();
    if (!text || !text.includes("R$")) continue;

    const cents = parseBrlToCents(text);
    if (cents !== null) return cents;
  }

  return null;
}

function findMerchantName(): string | null {
  const headings = Array.from(document.querySelectorAll<HTMLElement>("h2, h3"));

  for (const heading of headings) {
    if (!isVisible(heading)) continue;
    const text = heading.innerText?.trim();
    if (text && text.length >= 2 && text.length <= 100) return text;
  }

  return null;
}

export function extractIfoodOffer(): RawOffer {
  const h1 = document.querySelector<HTMLElement>("h1");
  const headingText = h1 && isVisible(h1) ? h1.innerText.trim() : "";
  const titleFallback = document.title.split("|")[0]?.trim() ?? "";

  const productName = headingText || titleFallback || null;
  const itemPriceCents = findVisiblePrice();
  const merchantName = findMerchantName();

  return {
    source: "ifood",
    url: window.location.href,
    merchantName,
    productName,
    itemPriceCents,
    observedAt: new Date().toISOString(),
    extraction: {
      productName: headingText
        ? "h1"
        : titleFallback
          ? "document-title"
          : "missing",
      itemPrice: itemPriceCents === null ? "missing" : "visible-price-text",
      merchantName: merchantName ? "visible-heading" : "missing"
    }
  };
}
