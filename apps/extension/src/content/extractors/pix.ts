import { parseBRL } from "@nape3/domain";
import { looksLikePixPayload, parsePixBrCode } from "@nape3/payments";
import type { PixSnapshot } from "../../shared/types";
import { field, findByOwnText, isOnScreen, isVisible, missing, ownText, textOf } from "../dom";

/**
 * Reads what the payment screen *shows*: a Pix Copia e Cola payload, a QR
 * image, a visible key, amount and expiration. It does not call any API,
 * intercept network traffic or read storage.
 */

function findPayload(doc: Document): { value: string; evidence: string } | null {
  for (const input of Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))) {
    if (isVisible(input) && looksLikePixPayload(input.value)) return { value: input.value.trim(), evidence: `<${input.tagName.toLowerCase()}> value` };
  }
  const walker = doc.createTreeWalker(doc.body, 4 /* SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const match = /000201\S+/.exec(node.textContent ?? "");
    if (match && looksLikePixPayload(match[0]) && node.parentElement && isVisible(node.parentElement)) {
      return { value: match[0], evidence: "visible text" };
    }
  }
  return null;
}

function hasQrCode(doc: Document): boolean {
  const candidates = Array.from(doc.querySelectorAll("img, canvas, svg")).filter(isVisible);
  return candidates.some((el) => {
    const hint = `${el.getAttribute("alt") ?? ""} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("class") ?? ""} ${el.getAttribute("data-testid") ?? ""}`;
    return /qr/i.test(hint);
  });
}

/** "Expira em 29:59", "expira em 30 minutos", "válido até 14:32". */
export function parseExpiration(text: string, now: Date): string | null {
  const countdown = /expira(?:r[aá])? em\s*(\d{1,2}):(\d{2})/i.exec(text);
  if (countdown) {
    return new Date(now.getTime() + (Number(countdown[1]) * 60 + Number(countdown[2])) * 1000).toISOString();
  }
  const minutes = /expira(?:r[aá])? em\s*(\d{1,3})\s*min/i.exec(text);
  if (minutes) return new Date(now.getTime() + Number(minutes[1]) * 60_000).toISOString();
  const until = /v[aá]lido at[eé]\s*(?:as\s*)?(\d{1,2})[:h](\d{2})/i.exec(text);
  if (until) {
    // Local wall-clock time on the user's machine (the page shows local time).
    const at = new Date(now);
    at.setHours(Number(until[1]), Number(until[2]), 0, 0);
    if (at.getTime() < now.getTime()) at.setDate(at.getDate() + 1);
    return at.toISOString();
  }
  return null;
}

export function extractPixPayment(doc: Document, now: Date = new Date()): PixSnapshot {
  const root = doc.body;
  const payload = findPayload(doc);
  const parsed = payload ? parsePixBrCode(payload.value) : null;
  const parsedPayload = parsed?.ok ? parsed.code : null;
  const qrCodePresent = hasQrCode(doc);

  const keyLabel = findByOwnText(root, /^chave pix:?$/i)[0];
  const keyValue = keyLabel?.nextElementSibling ? textOf(keyLabel.nextElementSibling) : null;

  let amountCents: PixSnapshot["amountCents"];
  if (parsedPayload?.amountCents !== undefined && parsedPayload.crcValid) {
    amountCents = field(parsedPayload.amountCents, "high", "Pix payload tag 54 (CRC valid)");
  } else {
    // Pix-specific labels only, on screen only. "Total" belongs to the order summary
    // (and a stale bag drawer can hold an old one).
    const label = findByOwnText(root, /^(valor|valor a pagar|valor do pix):?$/i).find(isOnScreen);
    const value = label ? parseBRL(textOf(label.parentElement ?? label)) : null;
    amountCents = value !== null ? field(value, "medium", `"${textOf(label!.parentElement ?? label!)}"`) : missing("amount not visible");
  }

  const expLabel = findByOwnText(root, /expira|v[aá]lido at[eé]/i)[0];
  const expiresAt = expLabel ? parseExpiration(textOf(expLabel), now) : null;

  const pixOptionVisible =
    findByOwnText(root, /^pix$|pix copia e cola|pague com pix/i).length > 0 || payload !== null;

  return {
    pixOptionVisible,
    copyPastePayload: payload
      ? field(payload.value, parsedPayload?.crcValid ? "high" : "low", `${payload.evidence}${parsedPayload ? (parsedPayload.crcValid ? ", CRC valid" : ", CRC INVALID") : ", not parseable"}`)
      : missing("no Pix Copia e Cola payload visible"),
    parsedPayload,
    qrCodePresent,
    pixKey: keyValue ? field(keyValue, "medium", `"${ownText(keyLabel!)}" sibling`) : parsedPayload?.pixKey ? field(parsedPayload.pixKey, "high", "payload tag 26.01") : missing("no visible Pix key"),
    amountCents,
    expiresAt: expiresAt ? field(expiresAt, "medium", `"${textOf(expLabel!)}"`) : missing("no expiration visible"),
    preferredEvidence: payload ? "pix-copy-paste" : qrCodePresent ? "qr-code" : keyValue ? "pix-key" : null
  };
}
