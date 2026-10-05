// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { capturePage, scrub } from "../src/content/capture";
import { takeSnapshot } from "../src/content/extract";

const PIX = "00020126580014br.gov.bcb.pix0136a1b2c3d4-e5f6-7890-abcd-ef1234567890520400005303986540527.795802BR5913LOJA EXEMPLO6009SAO PAULO62070503***6304ABCD";

function page(html: string, url = "https://www.ifood.com.br/pedido/finalizar?utm=abc&id=123") {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url }).window.document;
}

describe("calibration capture never exports personal data", () => {
  const doc = page(`
    <header><span>Olá, Maria Silva</span><span>Rua das Flores, 123 - Apto 45</span></header>
    <nav><a href="/perfil">Perfil de Maria</a></nav>
    <main>
      <h1>Finalizar pedido</h1>
      <p>Entregar em Avenida Paulista 1000, CEP 01310-100</p>
      <p>Contato: maria@example.com · (11) 98765-4321 · CPF 123.456.789-09</p>
      <p>Pedido para Maria Silva</p>
      <input type="text" name="pix" value="${PIX}" />
      <input type="text" name="document" value="12345678909" />
      <span>Pix Copia e Cola: ${PIX}</span>
      <a href="/delivery/sao-paulo-sp/loja/0f8fad5b-d9cb-469f-a165-70867728950e?ref=xyz">Loja</a>
      <div>Subtotal</div><div>R$ 21,88</div><div>Total</div><div>R$ 27,79</div>
    </main>
    <footer>Maria Silva · CNPJ</footer>`);
  const capture = capturePage(doc, takeSnapshot(doc, doc.location.href), { redactions: ["Maria Silva", "Maria"] });

  it("keeps header/nav/footer as structure only: interface words survive, the address and name do not", () => {
    expect(capture).not.toContain("Rua das Flores");
    expect(capture).not.toContain("Perfil de Maria");
    expect(capture).not.toContain("CNPJ");
    expect(capture).toMatch(/<header>/);
    expect(capture).toMatch(/\[text \d+ chars\]/);
  });

  it("scrubs addresses, CEPs, e-mails, phones, CPFs, the user's own words and Pix payloads", () => {
    for (const secret of ["Paulista 1000", "01310-100", "maria@example.com", "98765-4321", "123.456.789-09", "Maria", PIX, "br.gov.bcb.pix0136"]) {
      expect(capture).not.toContain(secret);
    }
    expect(capture).toMatch(/\[pix-payload \d+ chars\]/);
    expect(capture).toContain("[redacted]");
  });

  it("never exports input values, only their shape", () => {
    expect(capture).not.toContain("12345678909");
    expect(capture).toMatch(/<input[^>]*name="pix"[^>]*value-length="\d+"[^>]*value-kind="pix-payload"/);
  });

  it("keeps route shapes without ids or query values", () => {
    expect(capture).toContain('href="/delivery/sao-paulo-sp/loja/[id]"');
    expect(capture).not.toContain("0f8fad5b");
    expect(capture).not.toContain("xyz");
    expect(capture).toContain("query: utm=text(3), id=integer(3 digits)");
    expect(capture).not.toContain("abc");
  });

  it("keeps what calibration needs: labels, amounts and the extraction result", () => {
    expect(capture).toContain('"Subtotal"');
    expect(capture).toContain('"R$ 27,79"');
    expect(capture).toContain("<!-- EXTRACTION");
    expect(capture).toMatch(/"context": "\w+"/);
  });
});

describe("delivery-context spike: address picker and URL shapes", () => {
  it("shows where the address picker is without its content", () => {
    const doc = page(`<header><button aria-label="Endereço de entrega"><span>Entregar em</span><span>Rua Augusta, 1500</span></button><button>Alterar</button></header><main></main>`);
    const capture = capturePage(doc, takeSnapshot(doc, doc.location.href));
    expect(capture).toContain('aria-label="Endereço de entrega"');
    expect(capture).toContain('"Entregar em"');
    expect(capture).toContain('"Alterar"');
    expect(capture).not.toContain("Augusta");
    expect(capture).toContain('"[text 17 chars]"');
  });

  it("describes query values by shape only (coordinates never leak)", async () => {
    const { valueShape } = await import("../src/content/capture");
    expect(valueShape("-23.561414")).toBe("number(6 decimals)");
    expect(valueShape("-23.56,-46.65")).toBe("coordinate-pair");
    expect(valueShape("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe("uuid");
    expect(valueShape("acai")).toBe("text(4)");
    const doc = page("<main></main>", "https://www.ifood.com.br/busca?q=acai&latitude=-23.561414&longitude=-46.655881");
    const capture = capturePage(doc, takeSnapshot(doc, doc.location.href));
    expect(capture).toContain("query: q=text(4), latitude=number(6 decimals), longitude=number(6 decimals)");
    expect(capture).not.toContain("23.56");
  });
});

describe("delivery-context spike: structure-only capture of the address picker", () => {
  const doc = page(`
    <main><h1>Restaurantes</h1></main>
    <div role="dialog" aria-modal="true">
      <h2>Endereço de entrega</h2>
      <input type="text" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="sugg-list" autocomplete="off" placeholder="Buscar endereço e número" value="Rua Augusta 15" />
      <ul id="sugg-list" role="listbox">
        <li role="option" aria-selected="true" id="opt-0">Rua Augusta, 1500 - Consolação, São Paulo</li>
        <li role="option" id="opt-1">Rua Augusta, 150 - Cerqueira César</li>
      </ul>
      <button>Usar minha localização</button>
      <button>Confirmar localização</button>
    </div>`);
  const capture = capturePage(doc, takeSnapshot(doc, doc.location.href), { structureOnly: true });

  it("keeps the widget mechanics an automation needs", () => {
    expect(capture).toMatch(/<input[^>]*role="combobox"[^>]*aria-expanded="true"[^>]*aria-controls="sugg-list"[^>]*aria-autocomplete="list"/);
    expect(capture).toMatch(/<li[^>]*role="option"[^>]*aria-selected="true"[^>]*id="opt-0"/);
    expect(capture).toContain('"Confirmar localização"');
    expect(capture).toContain('"Usar minha localização"');
    expect(capture).toContain("STRUCTURE ONLY");
  });

  it("exports no address text at all: not the typed value, not the suggestions, not the extraction", () => {
    for (const secret of ["Augusta", "1500", "Consolação", "Cerqueira", "São Paulo"]) expect(capture).not.toContain(secret);
    expect(capture).toContain("<!-- EXTRACTION omitted (structure only) -->");
    expect(capture).toMatch(/"\[text \d+ chars\]"/);
  });

  it("reports how the page was reached (SPA vs reload)", () => {
    expect(capture).toMatch(/page loaded \d+ s ago · navigation type \w+ · history length \d+/);
  });
});

describe("calibration capture shape", () => {
  it("collapses long lists (search results, menus) after the first few", () => {
    const items = Array.from({ length: 30 }, (_, i) => `<li><a href="/delivery/x/loja-${i}/[id]">Loja ${i}</a><span>R$ ${i},90</span></li>`).join("");
    const capture = capturePage(page(`<main><ul>${items}</ul></main>`, "https://www.ifood.com.br/busca?q=acai"), takeSnapshot(page("<main></main>"), "https://www.ifood.com.br/busca?q=acai"));
    expect(capture).toContain("Loja 5");
    expect(capture).not.toContain("Loja 6<");
    expect(capture).not.toContain('"Loja 6"');
    expect(capture).toContain("24 more similar children omitted");
  });

  it("includes an open dialog or drawer that lives outside main", () => {
    const doc = page(`<main><p>Cardápio</p></main><div role="dialog"><h2>Açaí 500ml</h2><button>Adicionar R$ 21,90</button></div>`, "https://www.ifood.com.br/delivery/sp/loja/0f8fad5b-d9cb-469f-a165-70867728950e?item=1");
    const capture = capturePage(doc, takeSnapshot(doc, doc.location.href));
    expect(capture).toContain("dialog/drawer outside main");
    expect(capture).toContain('"Açaí 500ml"');
  });

  it("scrub keeps prices and short numbers intact", () => {
    expect(scrub("2x Açaí 500ml R$ 21,90 · entrega 30-40 min")).toBe("2x Açaí 500ml R$ 21,90 · entrega 30-40 min");
  });
});
