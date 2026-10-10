import { describe, expect, it } from "vitest";
import { createMerchantMemory, merchantFromUrl } from "../src/content/merchant";
import { forbiddenContent } from "../../web/src/lib/dev-bridge";

const ID = "2b1c6f7e-3d4a-4b5c-9d8e-1f2a3b4c5d6e";
const URL_R = `https://www.ifood.com.br/delivery/sao-paulo-sp/maranata-acai-vila-mariana/${ID}`;
const T0 = new Date("2026-10-10T12:00:00Z");

describe("restaurant link as merchant id", () => {
  it("reads city, slug and id from the public path, ignoring query and hash", () => {
    expect(merchantFromUrl(`${URL_R}?item=abc&token=secret#x`)).toEqual({
      platformId: ID,
      city: "sao-paulo-sp",
      slug: "maranata-acai-vila-mariana",
      path: `/delivery/sao-paulo-sp/maranata-acai-vila-mariana/${ID}`
    });
    expect(merchantFromUrl("https://www.ifood.com.br/busca?q=acai")).toBeNull();
    expect(merchantFromUrl("not a url")).toBeNull();
  });

  it("keeps the restaurant when a product, the bag or checkout opens", () => {
    const memory = createMerchantMemory();
    expect(memory.resolve(URL_R, "RESTAURANT", "Maranata Açaí", T0)).toMatchObject({ via: "url", name: "Maranata Açaí" });
    // Product modal on the same path keeps the name even though no <h1> is read there.
    expect(memory.resolve(`${URL_R}?item=1`, "PRODUCT", null, T0)).toMatchObject({ via: "url", name: "Maranata Açaí", platformId: ID });
    // Checkout on another path: carried from the restaurant page.
    expect(memory.resolve("https://www.ifood.com.br/pedido/finalizar", "CHECKOUT", "maranata açaí", T0)).toMatchObject({ via: "carried", platformId: ID });
  });

  it("does not carry it to unrelated pages, to another merchant, or after 2 h", () => {
    const memory = createMerchantMemory();
    memory.resolve(URL_R, "RESTAURANT", "Maranata Açaí", T0);
    expect(memory.resolve("https://www.ifood.com.br/busca?q=acai", "SEARCH_RESULTS", null, T0)).toBeUndefined();
    expect(memory.resolve("https://www.ifood.com.br/pedido/finalizar", "CHECKOUT", "Outra Loja", T0)).toBeUndefined();
    expect(memory.resolve("https://www.ifood.com.br/pedido/finalizar", "CHECKOUT", null, new Date(T0.getTime() + 3 * 3600_000))).toBeUndefined();
  });

  it("is not refused as personal data by the bridge", () => {
    const merchant = createMerchantMemory().resolve(URL_R, "RESTAURANT", "Maranata Açaí", T0);
    expect(forbiddenContent(JSON.stringify({ merchant }))).toBeNull();
  });
});
