/**
 * Extension Dev Bridge: a temporary observatory for development, not product
 * storage. The extension (Debug mode + bridge enabled) posts SANITIZED page
 * snapshots; developers read the latest one back.
 *
 * Rules enforced here:
 *  - off unless DEV_BRIDGE_TOKEN (writes) and a Blob store credential are set
 *    (BLOB_READ_WRITE_TOKEN, or BLOB_STORE_ID with Vercel OIDC);
 *  - writes need `Authorization: Bearer <DEV_BRIDGE_TOKEN>`; the token is never in code;
 *  - session ids are random (128 bits) and unrelated to any account; reads are
 *    by session id only (capability), and only of sanitized data;
 *  - logical TTL of 30 minutes: expired sessions refuse writes, and expired
 *    objects are deleted on every write and read;
 *  - a second sanitization check here: a payload that still carries an e-mail,
 *    CPF, CEP, phone, Pix payload or street address is REJECTED, not stored;
 *  - never AgentRun, events or market data: snapshots only.
 */

export const TTL_MS = 30 * 60_000;
export const MAX_SNAPSHOT_BYTES = 512 * 1024;
export const SCHEMA = "upay3food.dev-snapshot.v1";
const ROOT = "dev-bridge/";

export interface BridgeEnv {
  DEV_BRIDGE_TOKEN?: string | undefined;
  BLOB_READ_WRITE_TOKEN?: string | undefined;
  BLOB_STORE_ID?: string | undefined;
  [key: string]: string | undefined;
}

export interface StoredObject {
  pathname: string;
  uploadedAt: Date;
  size: number;
}

/** The storage the bridge needs; Vercel Blob in production, a Map in tests. */
export interface BridgeStore {
  put(pathname: string, body: string): Promise<void>;
  list(prefix: string): Promise<StoredObject[]>;
  get(pathname: string): Promise<string | null>;
  del(pathnames: string[]): Promise<void>;
}

export interface DevSnapshot {
  schema: typeof SCHEMA;
  capturedAt: string;
  context: string;
  detection: { context: string; confidence: number; signals: string[] };
  /** What the extension extracted (already scrubbed by the extension). */
  extracted: Record<string, unknown>;
  /** Sanitized page structure (calibration capture). */
  sanitizedStructure: string;
  diagnostics: { extensionVersion: string; pageContext: string; navigationType: string | null; pageAgeSeconds: number | null; path: string };
}

export const MIN_TOKEN_LENGTH = 24;

export function bridgeEnabled(env: BridgeEnv): boolean {
  return bridgeConfig(env).enabled;
}

/** Configuration state for /api/dev/extension/status: never the values, only whether each piece is usable. */
export function bridgeConfig(env: BridgeEnv): {
  enabled: boolean;
  devBridgeToken: "missing" | "too-short" | "ok";
  blobToken: "missing" | "ok";
  /** How the Blob store is reached: a read-write token, or the store id with Vercel OIDC. */
  blobAuth: "read-write-token" | "oidc" | "missing";
  minTokenLength: number;
} {
  const token = (env.DEV_BRIDGE_TOKEN ?? "").trim();
  const devBridgeToken = token === "" ? "missing" : token.length < MIN_TOKEN_LENGTH ? "too-short" : "ok";
  const blobAuth = (env.BLOB_READ_WRITE_TOKEN ?? "").trim() ? "read-write-token" : (env.BLOB_STORE_ID ?? "").trim() ? "oidc" : "missing";
  const blobToken = blobAuth === "missing" ? "missing" : "ok";
  return { enabled: devBridgeToken === "ok" && blobToken === "ok", devBridgeToken, blobToken, blobAuth, minTokenLength: MIN_TOKEN_LENGTH };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function authorized(request: Request, env: BridgeEnv): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = (/^Bearer (.+)$/.exec(header)?.[1] ?? "").trim();
  const expected = (env.DEV_BRIDGE_TOKEN ?? "").trim();
  return !!expected && timingSafeEqual(token, expected);
}

export const SESSION_ID = /^[0-9a-f]{32}$/;

export function newSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Patterns that must never be stored. The extension already scrubs them; a
 * match here means sanitization failed upstream, so the snapshot is refused.
 * The rule name is returned, never the matched text.
 */
const FORBIDDEN: Array<[string, RegExp]> = [
  ["email", /[\w.+-]+@[\w-]+\.[\w.]+/],
  ["cpf", /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
  ["cep", /\b\d{5}-\d{3}\b/],
  ["phone", /(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]\d{4}\b/],
  ["pix-payload", /000201\S*br\.gov\.bcb\.pix/i],
  ["street-address", /\b(rua|avenida|alameda|travessa|rodovia|estrada)\s+[A-ZÀ-Úa-zà-ú]{3,}[^"\n]{0,40}\d/i],
  ["auth-material", /\b(cookie|set-cookie|authorization|bearer\s+[a-z0-9._-]{12,}|access_token|refresh_token)\b/i]
];

export function forbiddenContent(text: string): string | null {
  for (const [rule, pattern] of FORBIDDEN) if (pattern.test(text)) return rule;
  return null;
}

export function validateSnapshot(value: unknown): { ok: true; snapshot: DevSnapshot } | { ok: false; error: string } {
  const s = value as Partial<DevSnapshot> | null;
  if (!s || typeof s !== "object") return { ok: false, error: "not an object" };
  if (s.schema !== SCHEMA) return { ok: false, error: `schema must be ${SCHEMA}` };
  if (typeof s.capturedAt !== "string" || Number.isNaN(Date.parse(s.capturedAt))) return { ok: false, error: "capturedAt" };
  if (typeof s.context !== "string" || !/^[A-Z_]{3,40}$/.test(s.context)) return { ok: false, error: "context" };
  if (!s.detection || typeof s.detection !== "object") return { ok: false, error: "detection" };
  if (!s.extracted || typeof s.extracted !== "object") return { ok: false, error: "extracted" };
  if (typeof s.sanitizedStructure !== "string") return { ok: false, error: "sanitizedStructure" };
  if (!s.diagnostics || typeof s.diagnostics !== "object") return { ok: false, error: "diagnostics" };
  return { ok: true, snapshot: s as DevSnapshot };
}

const sessionPath = (id: string) => `${ROOT}${id}/session.json`;
const snapshotPrefix = (id: string) => `${ROOT}${id}/snap-`;

/** Deletes everything older than the TTL (sessions and snapshots alike). */
export async function sweep(store: BridgeStore, now: number): Promise<number> {
  const all = await store.list(ROOT);
  const expired = all.filter((o) => now - o.uploadedAt.getTime() > TTL_MS).map((o) => o.pathname);
  if (expired.length) await store.del(expired);
  return expired.length;
}

async function sessionAlive(store: BridgeStore, id: string, now: number): Promise<boolean> {
  const [session] = (await store.list(sessionPath(id))).filter((o) => o.pathname === sessionPath(id));
  return !!session && now - session.uploadedAt.getTime() <= TTL_MS;
}

export async function createSession(store: BridgeStore, now: number): Promise<{ sessionId: string; expiresAt: string }> {
  await sweep(store, now);
  const sessionId = newSessionId();
  await store.put(sessionPath(sessionId), JSON.stringify({ createdAt: new Date(now).toISOString() }));
  return { sessionId, expiresAt: new Date(now + TTL_MS).toISOString() };
}

export type AddResult = { ok: true; stored: string } | { ok: false; status: number; error: string };

export async function addSnapshot(store: BridgeStore, id: string, raw: string, now: number): Promise<AddResult> {
  if (!SESSION_ID.test(id)) return { ok: false, status: 400, error: "bad session id" };
  if (new TextEncoder().encode(raw).length > MAX_SNAPSHOT_BYTES) return { ok: false, status: 413, error: "snapshot too large" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: "invalid JSON" };
  }
  const valid = validateSnapshot(parsed);
  if (!valid.ok) return { ok: false, status: 400, error: `invalid snapshot: ${valid.error}` };
  const leak = forbiddenContent(raw);
  if (leak) return { ok: false, status: 422, error: `refused: snapshot still contains ${leak} (sanitization failed; nothing stored)` };
  await sweep(store, now);
  if (!(await sessionAlive(store, id, now))) return { ok: false, status: 410, error: "session unknown or expired" };
  const name = `${snapshotPrefix(id)}${new Date(now).toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}.json`;
  await store.put(name, JSON.stringify({ ...valid.snapshot, receivedAt: new Date(now).toISOString() }));
  return { ok: true, stored: name.slice(name.lastIndexOf("/") + 1) };
}

export async function listSnapshots(store: BridgeStore, id: string, now: number): Promise<StoredObject[] | null> {
  if (!SESSION_ID.test(id)) return null;
  await sweep(store, now);
  const objects = await store.list(`${ROOT}${id}/`);
  if (!objects.some((o) => o.pathname === sessionPath(id))) return null;
  return objects.filter((o) => o.pathname.startsWith(snapshotPrefix(id))).sort((a, b) => a.pathname.localeCompare(b.pathname));
}

export async function latestSnapshot(store: BridgeStore, id: string, now: number): Promise<{ found: false } | { found: true; snapshot: unknown; count: number }> {
  const snaps = await listSnapshots(store, id, now);
  if (!snaps || snaps.length === 0) return { found: false };
  const body = await store.get(snaps[snaps.length - 1]!.pathname);
  return body ? { found: true, snapshot: JSON.parse(body), count: snaps.length } : { found: false };
}

/** In-memory store for tests and local development without Blob. */
export function memoryStore(clock: () => number = Date.now): BridgeStore & { size(): number } {
  const data = new Map<string, { body: string; uploadedAt: Date }>();
  return {
    size: () => data.size,
    async put(pathname, body) {
      data.set(pathname, { body, uploadedAt: new Date(clock()) });
    },
    async list(prefix) {
      return [...data.entries()].filter(([k]) => k.startsWith(prefix)).map(([pathname, v]) => ({ pathname, uploadedAt: v.uploadedAt, size: v.body.length }));
    },
    async get(pathname) {
      return data.get(pathname)?.body ?? null;
    },
    async del(pathnames) {
      for (const p of pathnames) data.delete(p);
    }
  };
}
