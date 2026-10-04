import type { AgentBrowserCommand, BrowserResult, BrowserResultBody } from "@nape3/agent";
import type { CartQuote } from "@nape3/domain";
import type { Orchestrator } from "../orchestrator";
import type { MarketPort } from "../ports";

/**
 * Simulated browser executor for the hackathon demo (DEMO_EXECUTOR=1).
 * It answers commands from the synthetic demo market, as if a browser had
 * re-read each fixture merchant: it never touches a real platform. Runs bound
 * to it are simulated runs over synthetic data, labelled as such everywhere.
 * The real executor is the extension.
 */
export class SimulatedExecutor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(
    private readonly orchestrator: Orchestrator,
    private readonly market: MarketPort,
    readonly executorId: string,
    private readonly now: () => Date = () => new Date(),
    /** Simulated "browser time" per command. */
    private readonly delayMs = 900
  ) {}

  start(intervalMs = 1_000) {
    this.timer = setInterval(() => void this.tick(), intervalMs);
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const command of await this.orchestrator.commandsFor(this.executorId)) {
        if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
        const result = await this.answer(command);
        await this.orchestrator.browserResult(command.runId, this.executorId, { ...result, commandId: command.commandId } as BrowserResult).catch(() => {});
      }
    } finally {
      this.busy = false;
    }
  }

  private async quoteFor(command: AgentBrowserCommand, stage: CartQuote["stage"]): Promise<CartQuote | null> {
    const { run } = await this.orchestrator.load(command.runId);
    const candidateId = command.type === "REVALIDATE_CANDIDATE" ? command.candidate.candidateId : run.selectedCandidate?.candidateId;
    const { observations } = await this.market.search(this.now());
    const observation = observations.find((o) => o.id === candidateId);
    return observation?.kind === "cart-quote" ? { ...observation.quote, stage } : null;
  }

  private async answer(command: AgentBrowserCommand): Promise<BrowserResultBody> {
    const capturedAt = this.now().toISOString();
    switch (command.type) {
      case "REVALIDATE_CANDIDATE": {
        const quote = await this.quoteFor(command, "cart");
        return quote ? { type: "QUOTE", quote, capturedAt, pageRef: "simulated:cart" } : { type: "UNAVAILABLE", reason: "not in the demo market" };
      }
      case "PREPARE_CHECKOUT":
      case "READ_CHECKOUT": {
        const quote = await this.quoteFor(command, "checkout");
        return quote ? { type: "QUOTE", quote, capturedAt, pageRef: "simulated:checkout" } : { type: "UNAVAILABLE", reason: "not in the demo market" };
      }
      case "READ_PIX":
        return { type: "PIX", amountCents: command.expectedAmountCents, evidence: "pix-selected" };
      case "VERIFY_ORDER":
        return { type: "ORDER", confirmed: true, evidence: "simulated:order-confirmation" };
    }
  }
}
