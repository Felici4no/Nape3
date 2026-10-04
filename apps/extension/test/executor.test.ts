// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import type { AgentBrowserCommand } from "@nape3/agent";
import { takeSnapshot } from "../src/content/extract";
import { answerCommand } from "../src/shared/executor";
import { DEFAULT_SETTINGS, type PageSnapshot } from "../src/shared/types";
import { harness, observation, SIGNATURE, T0 } from "../../agent-api/test/harness";

/**
 * The extension as the browser executor of a real agent-api run, driven by
 * the extractor fixtures (checkout 2× açaí R$27,79, Pix payload, order page).
 */

const OBSERVER = "11111111-2222-3333-4444-555555555555";
const pages = {
  cart: "https://www.ifood.com.br/delivery/sao-paulo-sp/acai-do-bairro/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab",
  checkout: "https://www.ifood.com.br/pedido/finalizar",
  pix: "https://www.ifood.com.br/pedido/pagamento",
  confirmation: "https://www.ifood.com.br/pedido/acompanhar",
  search: "https://www.ifood.com.br/busca?q=acai"
};

function snapshot(name: keyof typeof pages, at = T0): PageSnapshot {
  const html = readFileSync(join(__dirname, "fixtures", `${name}.html`), "utf8");
  return takeSnapshot(new JSDOM(html, { url: pages[name] }).window.document, pages[name], at);
}

const command = (c: Partial<AgentBrowserCommand> & { type: AgentBrowserCommand["type"] }) => ({ commandId: "r:c1", runId: "r", ...c }) as AgentBrowserCommand;
const candidate = { candidateId: "bairro", source: "ifood" as const, merchantName: "Açaí do Bairro", requirement: { category: "acai" as const, volumeMl: 500 }, quantity: 2, observedTotalCents: 2779 as never };

describe("browser executor: answers from the user's own page", () => {
  it("revalidates from a bag of the right merchant, asks the user otherwise", async () => {
    const ok = await answerCommand(command({ type: "REVALIDATE_CANDIDATE", candidate }), snapshot("checkout"), DEFAULT_SETTINGS, OBSERVER);
    expect(ok.result).toMatchObject({ type: "QUOTE", quote: { merchant: { name: "Açaí do Bairro" }, totalCents: 2779 }, pageRef: "ifood:checkout" });

    const elsewhere = await answerCommand(command({ type: "REVALIDATE_CANDIDATE", candidate: { ...candidate, merchantName: "Outra Loja" } }), snapshot("checkout"), DEFAULT_SETTINGS, OBSERVER);
    expect(elsewhere.result).toMatchObject({ type: "NEEDS_USER", reason: expect.stringContaining("the bag is from Açaí do Bairro") });
    expect(elsewhere.open).toBe("https://www.ifood.com.br/busca?q=Outra%20Loja");

    const noBag = await answerCommand(command({ type: "REVALIDATE_CANDIDATE", candidate }), snapshot("search"), DEFAULT_SETTINGS, OBSERVER);
    expect(noBag.result.type).toBe("NEEDS_USER");

    const rappi = await answerCommand(command({ type: "REVALIDATE_CANDIDATE", candidate: { ...candidate, source: "rappi" } }), snapshot("checkout"), DEFAULT_SETTINGS, OBSERVER);
    expect(rappi.result.type).toBe("UNAVAILABLE");
  });

  it("reads Pix: payload digest (never the payload), amount from the code", async () => {
    const { result } = await answerCommand(command({ type: "READ_PIX", expectedAmountCents: 2779 as never }), snapshot("pix"), DEFAULT_SETTINGS, OBSERVER);
    expect(result).toMatchObject({ type: "PIX", amountCents: 2779, evidence: "pix-copy-paste", payloadDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(result)).not.toMatch(/000201/); // the BR Code itself is not sent
    const selected = await answerCommand(command({ type: "READ_PIX", expectedAmountCents: 2779 as never }), snapshot("checkout"), DEFAULT_SETTINGS, OBSERVER);
    expect(selected.result).toMatchObject({ type: "PIX", amountCents: 2779, evidence: "pix-selected" });
  });

  it("verifies the order only on the order confirmation page", async () => {
    expect((await answerCommand(command({ type: "VERIFY_ORDER" }), snapshot("confirmation"), DEFAULT_SETTINGS, OBSERVER)).result).toMatchObject({ type: "ORDER", confirmed: true });
    expect((await answerCommand(command({ type: "VERIFY_ORDER" }), snapshot("checkout"), DEFAULT_SETTINGS, OBSERVER)).result.type).toBe("NEEDS_USER");
  });

  it("sends no cookies, URLs or identifiers in any result", async () => {
    const results = await Promise.all(
      [command({ type: "REVALIDATE_CANDIDATE", candidate }), command({ type: "READ_CHECKOUT" }), command({ type: "READ_PIX", expectedAmountCents: 2779 as never })].map((c) =>
        answerCommand(c, snapshot(c.type === "READ_PIX" ? "pix" : "checkout"), DEFAULT_SETTINGS, OBSERVER)
      )
    );
    const wire = JSON.stringify(results.map((r) => r.result));
    expect(wire).not.toContain("ifood.com.br");
    expect(wire).not.toContain(OBSERVER);
    expect(wire).not.toMatch(/cookie|token|session/i);
  });
});

describe("extension executor ⇄ agent-api run", () => {
  it("intent → market → revalidation in the user's checkout → Pix → wallet → confirm → settle → order", async () => {
    const market = [
      observation({ id: "bairro", merchant: "Açaí do Bairro", lines: [{ title: "Açaí 500ml Tradicional", unit: 1290, quantity: 2 }], delivery: 199, service: 0, minutesAgo: 15 }),
      observation({ id: "other", merchant: "Point do Açaí", lines: [{ title: "Açaí 500ml", unit: 1500, quantity: 2 }], delivery: 0, service: 0, minutesAgo: 20 })
    ];
    const h = await harness({ market });
    const { id } = await h.start("quero 2 açaí 500ml até R$30");

    const step = async (page: keyof typeof pages) => {
      const pending = await h.pending(id);
      const { result } = await answerCommand(pending, snapshot(page, new Date(h.nowIso())), DEFAULT_SETTINGS, OBSERVER);
      return h.orchestrator.browserResult(id, h.executorId, { ...result, commandId: pending.commandId } as never);
    };

    expect((await h.run(id)).selectedCandidate?.merchantName).toBe("Açaí do Bairro");
    expect((await step("checkout")).state).toBe("QUOTE_VALIDATED");
    expect((await step("checkout")).state).toBe("CHECKOUT_PREPARED");
    expect((await step("pix")).state).toBe("WALLET_REQUIRED");
    expect((await h.connect(id, 50_000_000n)).state).toBe("USER_CONFIRMATION");
    expect((await h.confirmShown(id)).payment.authorization?.amountCents).toBe(2779);
    expect((await h.orchestrator.paymentSubmitted(id, { signature: SIGNATURE })).state).toBe("SETTLED");
    expect((await step("confirmation")).state).toBe("ORDER_CONFIRMED");
    expect(h.messages()).toContain("Checkout confirmed at R$27,79");
  });
});
