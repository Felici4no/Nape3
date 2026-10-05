/**
 * Structured Solana RPC failure diagnostics for the Cloak deposit path.
 *
 * A failed preflight (`-32002`, "Transaction simulation failed") carries the
 * only deterministic explanation of the failure: the transaction error, the
 * program logs and the compute units consumed. The Cloak SDK re-wraps it as
 * `RelayInternalError("Relay returned an error: …")` using only the message
 * string, and generic error redaction strips the base64 context. This module
 * keeps the structure:
 *
 *   { code, message, data: { err, logs, unitsConsumed, replacementBlockhash, accounts } }
 *
 * Safety: it keeps program logs, instruction indexes, custom error codes and
 * public program ids / account addresses. It strips URLs and anything shaped
 * like an API key parameter. It never takes a signed transaction, a seed, a
 * private key, a Cloak spend key or a viewing secret as input, and it never
 * retries anything.
 */

export interface RpcFailureData {
  /** Transaction error as returned by the RPC, e.g. {"InstructionError":[2,{"Custom":4272}]} or "BlockhashNotFound". */
  err: unknown;
  logs: string[];
  unitsConsumed: number | null;
  replacementBlockhash: unknown;
  accounts: unknown;
}

export interface FailingInstruction {
  /** Instruction index from the transaction error; null when only the logs were available. */
  index: number | null;
  /** "Custom", "InvalidAccountData", … */
  error: string;
  customCode?: number;
  customCodeHex?: string;
  /** Program that failed, from the `Program <id> failed` log line. */
  program?: string;
  /** Known meaning of the custom code, when it is a Cloak shield-pool code. */
  meaning?: string;
}

export interface RpcFailureDiagnostic {
  code: number;
  message: string;
  data: RpcFailureData;
  /** Transaction-level error name when it is not an instruction error (e.g. "AddressLookupTableNotFound"). */
  transactionError: string | null;
  failingInstruction: FailingInstruction | null;
  /** Where the structure came from. */
  source: "rpc-response" | "solana-error-context" | "message-context";
}

/** Cloak shield-pool custom error codes (from @cloak.dev/sdk ShieldPoolErrors and classifyRelayError). */
export const CLOAK_ERROR_CODES: Readonly<Record<number, string>> = {
  4096: "Invalid Merkle root",
  4097: "Root not found in the roots ring",
  4112: "Zero-knowledge proof is invalid",
  4113: "Invalid proof size",
  4114: "Invalid public inputs",
  4128: "Double spend: nullifier already registered",
  4144: "Output addresses or amounts don't match the proof",
  4145: "Amount conservation failed",
  4147: "Invalid amount",
  4149: "Commitment already exists in the tree",
  4176: "Account validation failed",
  4184: "Insufficient lamports in pool or account",
  4185: "Invalid account owner",
  4193: "Insufficient funds",
  4195: "Missing required accounts",
  4240: "Invalid mint",
  4256: "Address has high risk; rejected",
  4257: "Risk check failed",
  4272: "Range sanctions quote expired (RangeQuoteExpired, 0x10b0)",
  4274: "Range quote wallet mismatch (0x10b2)",
  4275: "Range quote Ed25519 instruction missing (0x10b3)"
};

const MAX_LOGS = 120;
const MAX_LOG_LENGTH = 400;

/** Removes URLs and key-like query parameters from free text. */
export function stripSecrets(text: string): string {
  return text
    .replace(/\b(?:https?|wss?):\/\/\S+/gi, "[url]")
    .replace(/\b(api[-_]?key|apikey|token|x-token|access[-_]?token)=([^&\s'"]+)/gi, "$1=[redacted]");
}

function cleanLogs(logs: unknown): string[] {
  if (!Array.isArray(logs)) return [];
  return logs
    .filter((l): l is string => typeof l === "string")
    .slice(-MAX_LOGS)
    .map((l) => stripSecrets(l).slice(0, MAX_LOG_LENGTH));
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && /^\d+n?$/.test(value)) return Number(value.replace(/n$/, ""));
  return null;
}

/** `Program <id> failed: <reason>` (last one wins). */
function failedLine(logs: string[]): { program: string; reason: string } | undefined {
  for (let i = logs.length - 1; i >= 0; i--) {
    const m = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) failed: (.*)$/.exec(logs[i]!);
    if (m) return { program: m[1]!, reason: m[2]! };
  }
  return undefined;
}

function failedProgram(logs: string[]): string | undefined {
  return failedLine(logs)?.program;
}

function custom(code: number, index: number | null, program: string | undefined): FailingInstruction {
  return {
    index,
    error: "Custom",
    customCode: code,
    customCodeHex: `0x${code.toString(16)}`,
    ...(program ? { program } : {}),
    ...(CLOAK_ERROR_CODES[code] ? { meaning: CLOAK_ERROR_CODES[code] } : {})
  };
}

function analyse(err: unknown, logs: string[]): Pick<RpcFailureDiagnostic, "transactionError" | "failingInstruction"> {
  if (err && typeof err === "object" && "InstructionError" in err) {
    const [index, inner] = (err as { InstructionError: [number, unknown] }).InstructionError;
    const program = failedProgram(logs);
    if (inner && typeof inner === "object" && "Custom" in inner) {
      return { transactionError: null, failingInstruction: custom(Number((inner as { Custom: number }).Custom), Number(index), program) };
    }
    return {
      transactionError: null,
      failingInstruction: { index: Number(index), error: typeof inner === "string" ? inner : JSON.stringify(inner), ...(program ? { program } : {}) }
    };
  }
  if (typeof err === "string") return { transactionError: err, failingInstruction: null };
  if (err === null || err === undefined) {
    // Only logs (the encoded message context does not carry `err`): use the failure line.
    const line = failedLine(logs);
    if (line) {
      const hex = /custom program error: (0x[0-9a-f]+)/i.exec(line.reason);
      return { transactionError: null, failingInstruction: hex ? custom(Number.parseInt(hex[1]!, 16), null, line.program) : { index: null, error: line.reason, program: line.program } };
    }
  }
  if (err && typeof err === "object") return { transactionError: Object.keys(err)[0] ?? JSON.stringify(err), failingInstruction: null };
  return { transactionError: null, failingInstruction: null };
}

function build(code: number, message: string, data: Partial<RpcFailureData>, source: RpcFailureDiagnostic["source"]): RpcFailureDiagnostic {
  const logs = cleanLogs(data.logs);
  const clean: RpcFailureData = {
    err: data.err ?? null,
    logs,
    unitsConsumed: toNumber(data.unitsConsumed),
    replacementBlockhash: data.replacementBlockhash ?? null,
    accounts: data.accounts ?? null
  };
  return { code, message: stripSecrets(message).slice(0, 300), data: clean, ...analyse(clean.err, logs), source };
}

/** From a raw JSON-RPC error object: `{ code, message, data }` as the RPC returned it. */
export function diagnosticFromRpcError(error: { code?: unknown; message?: unknown; data?: unknown }): RpcFailureDiagnostic {
  const data = (error.data && typeof error.data === "object" ? error.data : {}) as Partial<RpcFailureData>;
  return build(Number(error.code ?? 0), String(error.message ?? ""), data, "rpc-response");
}

// ---------------------------------------------------------------------------
// @solana/errors context ("Decode this error by running `npx @solana/errors decode -- <code> '<base64>'`")
// ---------------------------------------------------------------------------

const DECODE_HINT = /Solana error #(-?\d+); Decode this error by running `npx @solana\/errors decode -- -?\d+ '([A-Za-z0-9+/=]+)'`/;

function base64ToUtf8(b64: string): string {
  if (typeof atob === "function") {
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, "base64").toString("utf8");
}

function decodeScalar(raw: string): unknown {
  if (/^-?\d+n$/.test(raw)) return BigInt(raw.slice(0, -1));
  const text = decodeURIComponent(raw);
  if (text === "undefined") return undefined;
  if (text === "null") return null;
  return text;
}

/**
 * Decodes the context `@solana/errors` encodes into production messages:
 * `key=value&…`, arrays as `%5B…%5D` with items joined by `%2C%20`. Log items
 * can themselves contain ", ", so `logs` is split only before "Program ".
 */
export function decodeSolanaErrorContext(base64: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of base64ToUtf8(base64).split("&")) {
    const eq = entry.indexOf("=");
    if (eq < 0) continue;
    const key = entry.slice(0, eq);
    const raw = entry.slice(eq + 1);
    if (raw.startsWith("%5B") && raw.endsWith("%5D")) {
      const inner = raw.slice(3, -3);
      const parts = inner === "" ? [] : key === "logs" ? inner.split(/%2C%20(?=Program%20|Program$)/) : inner.split("%2C%20");
      out[key] = parts.map(decodeScalar);
    } else {
      out[key] = decodeScalar(raw);
    }
  }
  return out;
}

/** The transaction error, recovered from the nested `cause` message of a -32002 context. */
function errFromCause(cause: unknown): unknown {
  if (typeof cause !== "string") return null;
  const m = DECODE_HINT.exec(cause);
  if (!m) return null;
  const code = Number(m[1]);
  const ctx = decodeSolanaErrorContext(m[2]!);
  // 4615001+ instruction errors; 4615026 = Custom (context { code, index }).
  if (code >= 4615000 && code < 4700000) {
    const index = Number(ctx.index ?? -1);
    if (ctx.code !== undefined) return { InstructionError: [index, { Custom: Number(ctx.code) }] };
    return { InstructionError: [index, String(ctx.errorName ?? `instruction error #${code}`)] };
  }
  // 7050001+ transaction errors.
  if (code >= 7050000 && code < 7100000) return String(ctx.errorName ?? `transaction error #${code}`);
  return `solana error #${code}`;
}

function fromContext(code: number, context: Record<string, unknown>, source: RpcFailureDiagnostic["source"]): RpcFailureDiagnostic {
  const err = context.err ?? (context.cause instanceof Error ? errFromCause(context.cause.message) : errFromCause(context.cause));
  return build(code, code === -32002 ? "Transaction simulation failed" : `Solana error #${code}`, { ...context, err } as Partial<RpcFailureData>, source);
}

/** Decodes a `Solana error #…; Decode this error …` message (or a text containing one). */
export function diagnosticFromMessage(text: string): RpcFailureDiagnostic | null {
  const m = DECODE_HINT.exec(text);
  if (!m) return null;
  return fromContext(Number(m[1]), decodeSolanaErrorContext(m[2]!), "message-context");
}

/**
 * Walks an error (SDK wrapper → cause → SolanaError) and returns the RPC
 * failure structure when one is present. Order: a SolanaError's live context,
 * then any message carrying the encoded context (RelayInternalError keeps it
 * in `message` / `relayMessage`).
 */
export function diagnosticFromError(error: unknown, depth = 0): RpcFailureDiagnostic | null {
  if (!error || depth > 5) return null;
  const e = error as { context?: Record<string, unknown> & { __code?: number }; cause?: unknown; message?: unknown; relayMessage?: unknown };
  if (e.context && typeof e.context === "object" && typeof e.context.__code === "number" && e.context.__code === -32002) {
    const { __code, ...context } = e.context;
    const cause = e.cause ?? context.cause;
    return fromContext(__code, { ...context, ...(cause instanceof Error ? { cause: cause.message } : {}) }, "solana-error-context");
  }
  for (const text of [e.relayMessage, e.message]) {
    if (typeof text === "string") {
      const d = diagnosticFromMessage(text);
      if (d) return d;
    }
  }
  return diagnosticFromError(e.cause, depth + 1);
}

/** Multi-line, human-readable and safe to display or copy. */
export function formatDiagnostic(d: RpcFailureDiagnostic): string {
  const lines = [`RPC error ${d.code}: ${d.message}`];
  if (d.failingInstruction) {
    const f = d.failingInstruction;
    lines.push(
      `Failing instruction ${f.index === null ? "(index not in logs)" : `#${f.index}`}${f.program ? ` (program ${f.program})` : ""}: ${f.error}${f.customCode !== undefined ? ` ${f.customCode} (${f.customCodeHex})` : ""}${f.meaning ? `: ${f.meaning}` : ""}`
    );
  } else if (d.transactionError) {
    lines.push(`Transaction error: ${d.transactionError}`);
  } else {
    lines.push(`err: ${JSON.stringify(d.data.err)}`);
  }
  if (d.data.unitsConsumed !== null) lines.push(`Compute units consumed: ${d.data.unitsConsumed}`);
  lines.push(`Program logs (${d.data.logs.length}):`, ...d.data.logs.map((l) => `  ${l}`));
  return lines.join("\n");
}
