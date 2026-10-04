import type { IncomingMessage, ServerResponse } from "node:http";
import { BROWSER_COMMAND_TYPES, describeLog, reduceRun, type BrowserResult } from "@nape3/agent";
import { isSolanaAddress, readWalletBalances } from "@nape3/chain";
import type { Orchestrator, RunUpdate } from "./orchestrator";
import { RuntimeError } from "./orchestrator";
import type { ChainPort } from "./ports";
import { toJson } from "./store/types";

/**
 * HTTP surface of the agent runtime.
 *
 *   POST /agent/executors                   register a browser executor → { executorId, executorToken }
 *   GET  /agent/executors/me/commands       pending commands (executor bearer)
 *   POST /agent/runs                        { request, executorId, userId? } → { run, runToken }
 *   GET  /agent/runs/:id                    run + events + next action (run token)
 *   GET  /agent/runs/:id/events             SSE stream of run events (run token via ?token=)
 *   POST /agent/runs/:id/browser-result     BrowserResult (executor bearer)
 *   POST /agent/runs/:id/wallet-state       { connected, address?, shieldedUsdc?, publicUsdc?, solLamports? } (run token)
 *   POST /agent/runs/:id/confirm            { digest, amountCents } | { reject: true } (run token)
 *   POST /agent/runs/:id/payment            { signature } (run token)
 *   GET  /agent/chain/balances?address=     public USDC + SOL via the server's RPC (RPC Fast)
 *   GET  /healthz
 */

const MAX_BODY = 64 * 1024;
const RUN_PATH = /^\/agent\/runs\/([A-Za-z0-9_-]{1,64})(\/(events|browser-result|wallet-state|confirm|payment))?$/;

export interface AppOptions {
  chain?: ChainPort;
  /** Extra allowed CORS origins (the web app when it calls directly). chrome-extension:// is always allowed. */
  allowedOrigins?: string[];
  rateLimitPerMinute?: number;
  now?: () => Date;
  /** Exposed at GET /agent/demo when the simulated demo executor runs. */
  demo?: { executorId: string };
  log?: (entry: Record<string, unknown>) => void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(chunk as Buffer);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "invalid JSON object");
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(toJson(body));
}

function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : undefined;
}

/** In-process fan-out of run updates to SSE subscribers. */
export class RunEventBus {
  private readonly subscribers = new Map<string, Set<(update: RunUpdate) => void>>();
  publish = (update: RunUpdate) => {
    for (const fn of this.subscribers.get(update.run.id) ?? []) fn(update);
  };
  subscribe(runId: string, fn: (update: RunUpdate) => void): () => void {
    const set = this.subscribers.get(runId) ?? new Set();
    set.add(fn);
    this.subscribers.set(runId, set);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.subscribers.delete(runId);
    };
  }
}

function parseBrowserResult(body: Record<string, unknown>): BrowserResult {
  const type = body.type;
  const commandId = body.commandId;
  if (typeof commandId !== "string" || commandId.length > 120) throw new HttpError(400, "commandId is required");
  const str = (k: string, max = 200) => {
    const v = body[k];
    if (typeof v !== "string" || v.length > max) throw new HttpError(400, `${k} must be a string`);
    return v;
  };
  switch (type) {
    case "STARTED":
      return { type, commandId };
    case "QUOTE":
      if (!body.quote || typeof body.quote !== "object") throw new HttpError(400, "quote is required");
      return { type, commandId, quote: body.quote as never, capturedAt: str("capturedAt", 40), pageRef: str("pageRef", 40) };
    case "PIX": {
      const amount = body.amountCents;
      const evidence = body.evidence;
      if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, "amountCents must be integer cents");
      if (!["pix-copy-paste", "qr-code", "pix-key", "pix-selected"].includes(String(evidence))) throw new HttpError(400, "invalid evidence");
      return {
        type,
        commandId,
        amountCents: amount as never,
        evidence: evidence as never,
        ...(typeof body.expiresAt === "string" ? { expiresAt: body.expiresAt.slice(0, 40) } : {}),
        ...(typeof body.payloadDigest === "string" ? { payloadDigest: body.payloadDigest.slice(0, 64) } : {})
      };
    }
    case "ORDER":
      return { type, commandId, confirmed: body.confirmed === true, evidence: str("evidence", 120) };
    case "UNAVAILABLE":
    case "NEEDS_USER":
    case "ERROR":
      return { type, commandId, reason: str("reason") };
    default:
      throw new HttpError(400, "unknown result type");
  }
}

export function createApp(orchestrator: Orchestrator, bus: RunEventBus, options: AppOptions = {}) {
  const now = options.now ?? (() => new Date());
  const limit = options.rateLimitPerMinute ?? 240;
  const hits = new Map<string, { windowStart: number; count: number }>();
  const log = options.log ?? (() => {});

  function rateLimited(ip: string): boolean {
    const t = now().getTime();
    const entry = hits.get(ip);
    if (!entry || t - entry.windowStart >= 60_000) {
      hits.set(ip, { windowStart: t, count: 1 });
      return false;
    }
    entry.count += 1;
    return entry.count > limit;
  }

  async function events(req: IncomingMessage, res: ServerResponse, runId: string, url: URL) {
    const after = Number(req.headers["last-event-id"] ?? url.searchParams.get("after") ?? 0) || 0;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    const write = (update: RunUpdate) => res.write(`id: ${update.event.seq}\nevent: run-event\ndata: ${toJson(update)}\n\n`);
    let last = after;
    const queued: RunUpdate[] = [];
    let replaying = true;
    const unsubscribe = bus.subscribe(runId, (u) => {
      if (replaying) queued.push(u);
      else if (u.event.seq > last) {
        last = u.event.seq;
        write(u);
      }
    });
    // Replay what happened before the subscription (resume with Last-Event-ID).
    const { events: all } = await orchestrator.load(runId);
    const described = describeLog(all);
    for (let i = 0; i < described.length; i++) {
      const { message, ...event } = described[i]!;
      if (event.seq <= after) continue;
      write({ event, run: reduceRun(all.slice(0, i + 1)), message });
      last = event.seq;
    }
    replaying = false;
    for (const u of queued.filter((q) => q.event.seq > last)) {
      last = u.event.seq;
      write(u);
    }
    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const origin = req.headers.origin;
    if (origin && (/^chrome-extension:\/\/[a-p]{32}$/.test(origin) || options.allowedOrigins?.includes(origin))) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("access-control-allow-headers", "content-type, authorization, last-event-id");
      res.setHeader("access-control-allow-methods", "GET, POST");
      res.setHeader("vary", "origin");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    try {
      if (rateLimited(req.socket.remoteAddress ?? "unknown")) throw new HttpError(429, "rate limited");
      if (req.method === "GET" && url.pathname === "/healthz") return send(res, 200, { ok: true });

      if (req.method === "GET" && url.pathname === "/agent/demo") {
        if (!options.demo) throw new HttpError(404, "demo executor is not running");
        return send(res, 200, { ok: true, executorId: options.demo.executorId, simulated: true });
      }

      if (req.method === "POST" && url.pathname === "/agent/executors") {
        return send(res, 201, { ok: true, ...(await orchestrator.registerExecutor()) });
      }

      if (req.method === "GET" && url.pathname === "/agent/executors/me/commands") {
        const executorId = await orchestrator.authenticateExecutor(bearer(req));
        const commands = await orchestrator.commandsFor(executorId);
        return send(res, 200, { ok: true, commands, types: BROWSER_COMMAND_TYPES });
      }

      if (req.method === "GET" && url.pathname === "/agent/chain/balances") {
        if (!options.chain) throw new HttpError(503, "no chain provider configured");
        const address = url.searchParams.get("address") ?? "";
        if (!isSolanaAddress(address)) throw new HttpError(400, "address must be a Solana address");
        const balances = await readWalletBalances(options.chain.provider, address, options.chain.usdcMint, now());
        return send(res, 200, { ok: true, ...balances });
      }

      if (req.method === "POST" && url.pathname === "/agent/runs") {
        const body = await readJson(req);
        if (typeof body.request !== "string" || !body.request.trim()) throw new HttpError(400, "request is required");
        if (typeof body.executorId !== "string") throw new HttpError(400, "executorId is required");
        const created = await orchestrator.createRun({
          request: body.request,
          executorId: body.executorId,
          ...(typeof body.userId === "string" ? { userId: body.userId.slice(0, 64) } : {}),
          ...(body.executionMode === "real" ? { executionMode: "real" as const } : {})
        });
        return send(res, 201, { ok: true, run: created.run, runToken: created.runToken });
      }

      const match = RUN_PATH.exec(url.pathname);
      if (match) {
        const runId = match[1]!;
        const sub = match[3];

        if (sub === "browser-result" && req.method === "POST") {
          const executorId = await orchestrator.authenticateExecutor(bearer(req));
          const run = await orchestrator.browserResult(runId, executorId, parseBrowserResult(await readJson(req)));
          return send(res, 200, { ok: true, state: run.state });
        }

        // Everything else is the run owner's: run token (header, or ?token= for EventSource).
        await orchestrator.authorizeRun(runId, bearer(req) ?? url.searchParams.get("token") ?? undefined);

        if (!sub && req.method === "GET") return send(res, 200, { ok: true, ...(await orchestrator.status(runId)) });
        if (sub === "events" && req.method === "GET") return events(req, res, runId, url);

        if (sub === "wallet-state" && req.method === "POST") {
          const body = await readJson(req);
          const s = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
          const run = await orchestrator.walletState(runId, {
            connected: body.connected === true,
            ...(s("address") ? { address: s("address")! } : {}),
            ...(s("shieldedUsdc") ? { shieldedUsdc: s("shieldedUsdc")! } : {}),
            ...(s("publicUsdc") ? { publicUsdc: s("publicUsdc")! } : {}),
            ...(s("solLamports") ? { solLamports: s("solLamports")! } : {})
          });
          return send(res, 200, { ok: true, run });
        }
        if (sub === "confirm" && req.method === "POST") {
          const body = await readJson(req);
          const run =
            body.reject === true
              ? await orchestrator.confirm(runId, { reject: true, ...(typeof body.reason === "string" ? { reason: body.reason } : {}) })
              : typeof body.digest === "string" && typeof body.amountCents === "number"
                ? await orchestrator.confirm(runId, { digest: body.digest, amountCents: body.amountCents })
                : (() => {
                    throw new HttpError(400, "digest and amountCents are required");
                  })();
          return send(res, 200, { ok: true, run });
        }
        if (sub === "payment" && req.method === "POST") {
          const body = await readJson(req);
          if (typeof body.signature !== "string") throw new HttpError(400, "signature is required");
          return send(res, 200, { ok: true, run: await orchestrator.paymentSubmitted(runId, { signature: body.signature }) });
        }
      }

      throw new HttpError(404, "not found");
    } catch (error) {
      if (error instanceof HttpError || error instanceof RuntimeError) return send(res, error.status, { ok: false, error: error.message });
      log({ event: "request.failed", error: error instanceof Error ? error.message : String(error) });
      return send(res, 500, { ok: false, error: "internal error" });
    }
  };
}
