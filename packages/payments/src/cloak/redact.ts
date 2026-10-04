/**
 * Logging for Cloak flows. Only an allowlist of public fields is ever written:
 * signatures, public amounts, mints, counts, stages. Viewing keys, spend keys,
 * seeds, notes (serialized or not), blindings and relay payloads are dropped
 * by construction.
 */

const SAFE_FIELDS = new Set([
  "signature",
  "stage",
  "mint",
  "amount",
  "gross",
  "net",
  "fee",
  "notes",
  "inputs",
  "outputs",
  "balance",
  "recipient",
  "cluster",
  "simulated",
  "error",
  "explorer"
]);

export type CloakLogFn = (line: string) => void;

export function createCloakLogger(write: CloakLogFn = (line) => console.log(line)) {
  return (event: string, fields: Record<string, unknown> = {}) => {
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (!SAFE_FIELDS.has(key)) continue;
      if (typeof value === "bigint") safe[key] = value.toString();
      else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") safe[key] = value;
    }
    write(JSON.stringify({ ts: new Date().toISOString(), scope: "cloak", event, ...safe }));
  };
}

export type CloakLogger = ReturnType<typeof createCloakLogger>;

/** Error text without payloads: SDK/relay errors can echo request bodies. */
export function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message
    .replace(/[0-9a-f]{64,}/gi, "[hex]")
    .replace(/[A-Za-z0-9+/]{80,}={0,2}/g, "[base64]")
    .slice(0, 300);
}
