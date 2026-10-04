import type { AgentBrowserCommand, AgentRun, BrowserResult, BrowserResultBody } from "@nape3/agent";
import { base58Encode, MockSolanaRpcProvider, USDC_MINTS } from "@nape3/chain";
import { type CartQuote, type CartQuoteObservation } from "@nape3/domain";
import { cartObservation, type CartSpec } from "@nape3/fixtures";
import { OfframpFunding, SimulatedSettlement, StaticMarket } from "../src/adapters";
import { Orchestrator, type RunUpdate } from "../src/orchestrator";
import type { SettlementPort } from "../src/ports";
import { MemoryRunStore } from "../src/store/memory";
import type { RunStore } from "../src/store/types";

export const T0 = new Date("2026-10-04T12:00:00.000Z");
export const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
export const OTHER_WALLET = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
export const USDC = USDC_MINTS["mainnet-beta"];
export const SIGNATURE = base58Encode(new Uint8Array(64).fill(9));

/** A live extension observation of açaí 500 ml. */
export function observation(spec: Partial<CartSpec> & { id: string; unit?: number; minutesAgo: number }, now = T0): CartQuoteObservation {
  const o = cartObservation({ source: "ifood", merchant: `Loja ${spec.id}`, lines: [{ title: "Açaí 500ml", unit: spec.unit ?? 0 }], delivery: 0, service: 0, ...spec } as CartSpec, now);
  return { ...o, provenance: { method: "browser-extension", live: true, synthetic: false } };
}

/** Market used by most scenarios: three fresh candidates, cheapest first. */
export const MARKET = [
  observation({ id: "a", unit: 1990, minutesAgo: 10 }),
  observation({ id: "b", unit: 2190, minutesAgo: 20, source: "rappi" }),
  observation({ id: "c", unit: 2390, minutesAgo: 30 })
];

export interface HarnessOptions {
  market?: CartQuoteObservation[];
  settlement?: SettlementPort | ((chain: MockSolanaRpcProvider) => SettlementPort);
  store?: RunStore;
  publicUsdc?: bigint;
  solLamports?: bigint;
  onUpdate?: (update: RunUpdate) => void;
}

export async function harness(options: HarnessOptions = {}) {
  let clock = T0.getTime();
  const store = options.store ?? new MemoryRunStore();
  const chain = new MockSolanaRpcProvider().setToken(WALLET, USDC, options.publicUsdc ?? 25_000_000n).setSol(WALLET, options.solLamports ?? 50_000_000n);
  chain.setToken(OTHER_WALLET, USDC, 25_000_000n).setSol(OTHER_WALLET, 50_000_000n);
  const updates: RunUpdate[] = [];
  const orchestrator = new Orchestrator({
    store,
    market: new StaticMarket(options.market ?? MARKET),
    funding: new OfframpFunding(),
    settlement: typeof options.settlement === "function" ? options.settlement(chain) : (options.settlement ?? new SimulatedSettlement()),
    chain: { provider: chain, usdcMint: USDC },
    now: () => new Date(clock),
    publish: (u) => {
      updates.push(u);
      options.onUpdate?.(u);
    },
    schedule: () => {}
  });
  const { executorId, executorToken } = await orchestrator.registerExecutor();

  const h = {
    orchestrator,
    store,
    chain,
    updates,
    executorId,
    executorToken,
    tick(minutes: number) {
      clock += minutes * 60_000;
    },
    nowIso: () => new Date(clock).toISOString(),
    async start(request = "quero um açaí 500ml até R$25") {
      const created = await orchestrator.createRun({ request, executorId });
      return { ...created, id: created.run.id };
    },
    async run(id: string): Promise<AgentRun> {
      return (await orchestrator.load(id)).run;
    },
    async pending(id: string): Promise<AgentBrowserCommand> {
      const command = (await h.run(id)).pendingCommand;
      if (!command) throw new Error("no pending command");
      return command;
    },
    /** The browser executor answers the pending command. */
    async answer(id: string, make: (command: AgentBrowserCommand) => BrowserResultBody): Promise<AgentRun> {
      const command = await h.pending(id);
      return orchestrator.browserResult(id, executorId, { ...make(command), commandId: command.commandId } as BrowserResult);
    },
    /** A quote as the executor would read it for the selected candidate. */
    quote(run: AgentRun, totalCents: number, stage: CartQuote["stage"], patch: Partial<CartQuote> = {}): CartQuote {
      const c = run.selectedCandidate!;
      const base = observation({ id: c.candidateId, unit: totalCents, minutesAgo: 0, source: c.source, merchant: c.merchantName }, new Date(clock)).quote;
      return { ...base, stage, ...patch };
    },
    async revalidate(id: string, totalCents?: number, patch: Partial<CartQuote> = {}) {
      const run = await h.run(id);
      return h.answer(id, () => ({ type: "QUOTE", quote: h.quote(run, totalCents ?? run.selectedCandidate!.observedTotalCents, "cart", patch), capturedAt: h.nowIso(), pageRef: "ifood:cart" }));
    },
    async checkout(id: string, totalCents?: number, patch: Partial<CartQuote> = {}) {
      const run = await h.run(id);
      return h.answer(id, () => ({ type: "QUOTE", quote: h.quote(run, totalCents ?? run.validatedQuote!.quote.totalCents, "checkout", patch), capturedAt: h.nowIso(), pageRef: "ifood:checkout" }));
    },
    async pix(id: string) {
      const run = await h.run(id);
      return h.answer(id, () => ({ type: "PIX", amountCents: run.checkout!.quote.quote.totalCents, evidence: "pix-copy-paste", payloadDigest: "a".repeat(64) }));
    },
    /** Intent → revalidated → checkout → Pix detected (waiting for the wallet). */
    async toPix(request?: string) {
      const started = await h.start(request);
      await h.revalidate(started.id);
      await h.checkout(started.id);
      await h.pix(started.id);
      return started;
    },
    async connect(id: string, shieldedUsdc: bigint, address = WALLET) {
      return orchestrator.walletState(id, { connected: true, address, shieldedUsdc: shieldedUsdc.toString() });
    },
    async confirmShown(id: string) {
      const run = await h.run(id);
      const request = run.payment.confirmationRequest!;
      return orchestrator.confirm(id, { digest: request.digest, amountCents: request.amountCents });
    },
    states(): string[] {
      return updates.map((u) => u.run.state);
    },
    messages(): string[] {
      return updates.map((u) => u.message);
    }
  };
  return h;
}
