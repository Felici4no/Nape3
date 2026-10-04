import { cents, type Cents } from "@nape3/domain";

/**
 * Parser for Pix "Copia e Cola" payloads (BR Code, EMV® QRCPS-MPM).
 * Pure string parsing of a payload the user can see on screen; no network,
 * no private APIs. CRC16-CCITT (poly 0x1021, init 0xFFFF) is validated.
 */

export interface PixBrCode {
  payload: string;
  crcValid: boolean;
  /** 01 = "12": single-use (typical of checkout/dynamic charges). */
  singleUse: boolean;
  /** Static key (26.01) — present for static codes. */
  pixKey?: string;
  /** Location URL (26.25) — present for dynamic codes; the amount lives server-side. */
  locationUrl?: string;
  description?: string;
  /** Tag 54. Absent in dynamic codes whose amount is only on the PSP side. */
  amountCents?: Cents;
  merchantName?: string;
  merchantCity?: string;
  txid?: string;
  currency?: string;
  countryCode?: string;
}

export type PixParseResult = { ok: true; code: PixBrCode } | { ok: false; error: string };

type Fields = Map<string, string>;

function parseTlv(input: string): Fields | null {
  const fields: Fields = new Map();
  let i = 0;
  while (i < input.length) {
    if (i + 4 > input.length) return null;
    const id = input.slice(i, i + 2);
    const length = Number.parseInt(input.slice(i + 2, i + 4), 10);
    if (!/^\d{2}$/.test(id) || Number.isNaN(length)) return null;
    const value = input.slice(i + 4, i + 4 + length);
    if (value.length !== length) return null;
    fields.set(id, value);
    i += 4 + length;
  }
  return fields;
}

export function crc16ccitt(input: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(input)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** "17.44" → 1744 cents, string arithmetic only. */
function parseAmount(value: string): Cents | undefined {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return undefined;
  return cents(Number.parseInt(match[1]!, 10) * 100 + Number.parseInt((match[2] ?? "0").padEnd(2, "0"), 10));
}

export function looksLikePixPayload(text: string): boolean {
  return /^000201/.test(text.trim()) && /br\.gov\.bcb\.pix/i.test(text);
}

export function parsePixBrCode(raw: string): PixParseResult {
  // Only line breaks are removed: spaces are significant inside TLV values ("Fulano de Tal").
  const payload = raw.trim().replace(/[\r\n]+/g, "");
  if (!payload.startsWith("000201")) return { ok: false, error: "not an EMV payload (missing 000201)" };

  const crcIndex = payload.lastIndexOf("6304");
  if (crcIndex === -1 || crcIndex + 8 !== payload.length) return { ok: false, error: "missing CRC field (63)" };

  const fields = parseTlv(payload);
  if (!fields) return { ok: false, error: "malformed TLV structure" };

  const merchantAccount = fields.get("26");
  const account = merchantAccount ? parseTlv(merchantAccount) : null;
  if (!account || account.get("00")?.toLowerCase() !== "br.gov.bcb.pix") {
    return { ok: false, error: "merchant account info is not Pix (br.gov.bcb.pix)" };
  }

  const crcValid = crc16ccitt(payload.slice(0, crcIndex + 4)) === payload.slice(crcIndex + 4).toUpperCase();
  const additional = fields.get("62") ? parseTlv(fields.get("62")!) : null;

  const code: PixBrCode = { payload, crcValid, singleUse: fields.get("01") === "12" };
  const assign = <K extends keyof PixBrCode>(key: K, value: PixBrCode[K] | undefined) => {
    if (value !== undefined) code[key] = value;
  };
  assign("pixKey", account.get("01"));
  assign("description", account.get("02"));
  assign("locationUrl", account.get("25"));
  assign("amountCents", fields.get("54") ? parseAmount(fields.get("54")!) : undefined);
  assign("merchantName", fields.get("59"));
  assign("merchantCity", fields.get("60"));
  assign("currency", fields.get("53"));
  assign("countryCode", fields.get("58"));
  assign("txid", additional?.get("05"));
  return { ok: true, code };
}

/** Builds a static BR Code. Used for tests and demos only; never for real charges. */
export function buildStaticPixBrCode(input: {
  pixKey: string;
  merchantName: string;
  merchantCity: string;
  amountCents?: Cents;
  txid?: string;
}): string {
  const tlv = (id: string, value: string) => `${id}${value.length.toString().padStart(2, "0")}${value}`;
  const amount =
    input.amountCents === undefined
      ? ""
      : tlv("54", `${Math.floor(input.amountCents / 100)}.${(input.amountCents % 100).toString().padStart(2, "0")}`);
  const body =
    tlv("00", "01") +
    tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", input.pixKey)) +
    tlv("52", "0000") +
    tlv("53", "986") +
    amount +
    tlv("58", "BR") +
    tlv("59", input.merchantName) +
    tlv("60", input.merchantCity) +
    tlv("62", tlv("05", input.txid ?? "***")) +
    "6304";
  return body + crc16ccitt(body);
}
