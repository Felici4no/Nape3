import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { DemoMarket, OfframpFunding, SimulatedSettlement } from "../src/adapters";
import { createApp, RunEventBus } from "../src/app";
import { SimulatedExecutor } from "../src/demo/simulated-executor";
import { Orchestrator } from "../src/orchestrator";
import { MemoryRunStore } from "../src/store/memory";
import { harness, SIGNATURE, WALLET } from "./harness";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => {
      s.closeAllConnections();
      return new Promise<void>((r) => s.close(() => r()));
    })
  );
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Reads SSE frames until `until` matches or the timeout passes. */
async function readSse(url: string, until: (types: string[]) => boolean, headers: Record<string, string> = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, { headers, signal: controller.signal });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frames: Array<{ id: number; type: string; state: string; message: string }> = [];
  let buffer = "";
  try {
    while (!until(frames.map((f) => f.type))) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const data = raw.split("\n").find((l) => l.startsWith("data: "));
        const id = raw.split("\n").find((l) => l.startsWith("id: "));
        if (data) {
          const parsed = JSON.parse(data.slice(6));
          frames.push({ id: Number(id?.slice(4)), type: parsed.event.type, state: parsed.run.state, message: parsed.message });
        }
      }
    }
  } catch (error) {
    if ((error as Error).name !== "AbortError") throw error;
    throw new Error(`SSE timed out; got ${frames.map((f) => f.type).join(",")}`);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return { status: response.status, frames };
}

describe("agent-api HTTP", () => {
  it("drives a run over HTTP: executor polling, results, wallet, confirmation, payment, SSE", async () => {
    const bus = new RunEventBus();
    const h = await harness({ onUpdate: bus.publish });
    const base = await listen(createApp(h.orchestrator, bus));
    const json = (r: Response) => r.json() as Promise<Record<string, any>>;
    const post = (path: string, body: unknown, token?: string) =>
      fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

    const executor = await json(await post("/agent/executors", {}));
    expect(executor.executorToken).toMatch(/^ex_[\w-]+\.[\w-]{43}$/);

    const created = await post("/agent/runs", { request: "quero um açaí 500ml até R$25", executorId: executor.executorId });
    expect(created.status).toBe(201);
    const { run, runToken } = await json(created);
    expect(run.state).toBe("REVALIDATION_REQUESTED");

    // run reads need the run token; executor endpoints need the executor token
    expect((await fetch(`${base}/agent/runs/${run.id}`)).status).toBe(401);
    expect((await fetch(`${base}/agent/executors/me/commands`)).status).toBe(401);
    expect((await post(`/agent/runs/${run.id}/browser-result`, { type: "STARTED", commandId: "x" }, h.executorToken)).status).toBe(403);

    const { commands } = await json(await fetch(`${base}/agent/executors/me/commands`, { headers: { authorization: `Bearer ${executor.executorToken}` } }));
    expect(commands).toHaveLength(1);
    const command = commands[0];
    expect(command).toMatchObject({ type: "REVALIDATE_CANDIDATE", runId: run.id });

    const answer = async (body: Record<string, unknown>) => {
      const r = await post(`/agent/runs/${run.id}/browser-result`, body, executor.executorToken);
      expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
    };
    await answer({ type: "STARTED", commandId: command.commandId });
    const current = (await h.run(run.id))!;
    await answer({ type: "QUOTE", commandId: command.commandId, quote: h.quote(current, 1990, "cart"), capturedAt: h.nowIso(), pageRef: "ifood:cart" });
    let pending = await h.pending(run.id);
    await answer({ type: "QUOTE", commandId: pending.commandId, quote: h.quote(current, 1990, "checkout"), capturedAt: h.nowIso(), pageRef: "ifood:checkout" });
    pending = await h.pending(run.id);
    await answer({ type: "PIX", commandId: pending.commandId, amountCents: 1990, evidence: "qr-code" });

    expect((await post(`/agent/runs/${run.id}/wallet-state`, { connected: true, address: "nope" }, runToken)).status).toBe(400);
    const wallet = await json(await post(`/agent/runs/${run.id}/wallet-state`, { connected: true, address: WALLET, shieldedUsdc: "50000000" }, runToken));
    expect(wallet.run.state).toBe("USER_CONFIRMATION");
    expect(wallet.run.payment.funds.shieldedUsdc).toBe("50000000"); // bigint → string on the wire

    const status = await json(await fetch(`${base}/agent/runs/${run.id}`, { headers: { authorization: `Bearer ${runToken}` } }));
    expect(status.nextAction).toEqual({ kind: "AWAIT_CONFIRMATION" });
    const request = status.run.payment.confirmationRequest;
    expect((await post(`/agent/runs/${run.id}/confirm`, { digest: request.digest, amountCents: 1 }, runToken)).status).toBe(409);
    expect((await json(await post(`/agent/runs/${run.id}/confirm`, { digest: request.digest, amountCents: request.amountCents }, runToken))).run.state).toBe("PAYMENT_AUTHORIZED");
    expect((await json(await post(`/agent/runs/${run.id}/payment`, { signature: SIGNATURE }, runToken))).run.state).toBe("SETTLED");

    // SSE: full replay, then resume after an id with Last-Event-ID
    const sse = await readSse(`${base}/agent/runs/${run.id}/events?token=${runToken}`, (t) => t.includes("ORDER_REQUESTED"));
    expect(sse.status).toBe(200);
    expect(sse.frames[0]).toMatchObject({ id: 1, type: "INTENT_CREATED" });
    expect(sse.frames.map((f) => f.message)).toEqual(expect.arrayContaining(["Searching market…", "Found 3 candidates (live market)", "Checkout confirmed at R$19,90", "Ready to pay"]));
    const resumed = await readSse(`${base}/agent/runs/${run.id}/events?token=${runToken}`, (t) => t.includes("ORDER_REQUESTED"), { "last-event-id": "18" });
    expect(resumed.frames[0]!.id).toBe(19);
    expect((await fetch(`${base}/agent/runs/${run.id}/events?token=wrong`)).status).toBe(401);
  });

  it("streams live updates to an open SSE connection", async () => {
    const bus = new RunEventBus();
    const h = await harness({ onUpdate: bus.publish });
    const base = await listen(createApp(h.orchestrator, bus));
    const { id, runToken } = await h.start();
    const stream = readSse(`${base}/agent/runs/${id}/events?token=${runToken}`, (t) => t.includes("QUOTE_VALIDATED"));
    await new Promise((r) => setTimeout(r, 100));
    await h.revalidate(id);
    const { frames } = await stream;
    expect(frames.map((f) => f.message)).toContain("Price confirmed in your session: R$19,90");
  });

  it("the simulated demo executor completes a synthetic run up to the wallet, labelled demo", async () => {
    const store = new MemoryRunStore();
    const market = new DemoMarket();
    const orchestrator = new Orchestrator({ store, market, funding: new OfframpFunding(), settlement: new SimulatedSettlement() });
    const { executorId } = await orchestrator.registerExecutor();
    const executor = new SimulatedExecutor(orchestrator, market, executorId, () => new Date(), 0);
    const { run } = await orchestrator.createRun({ request: "quero um açaí 500ml até R$25", executorId });
    for (let i = 0; i < 4; i++) await executor.tick();
    const { run: after, events } = await orchestrator.load(run.id);
    expect(after.state).toBe("WALLET_REQUIRED");
    expect(events.find((e) => e.type === "MARKET_SEARCHED")).toMatchObject({ payload: { sourceMode: "demo" } });
    expect(after.candidates.every((c) => c.provenance === "synthetic")).toBe(true);
  });
});
