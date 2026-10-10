import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { advise, compareBags, itemCost, METHODOLOGY_TEXT, parseIfoodLink, priceBreakdown, rankMenu, readBagFromText, readMenuFromText } from "@/lib/agent-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public MCP server: plug UPAY3FOOD into your own agent (Claude, ChatGPT,
 * Cursor…). Stateless calculation tools: the agent brings what it read on a
 * delivery page, UPAY3FOOD returns the three layers, per-litre views, menu
 * rankings and an estimated recommendation. Nothing is stored or fetched.
 */
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const brl = z.number().nonnegative().max(100_000);

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "price_breakdown",
      {
        title: "Você paga 3 vezes",
        description:
          "Split a delivery checkout into the 3 layers you pay: food, fees (delivery + service) and the difference to the cheapest comparable option. Amounts in BRL (reais). Missing delivery/service fees are estimated and flagged.",
        inputSchema: z.object({
          food_brl: brl.describe("items subtotal, or the item price on a product page"),
          delivery_fee_brl: brl.nullable().optional(),
          service_fee_brl: brl.nullable().optional().describe("iFood charges R$0,99 per order; omit to estimate"),
          discount_brl: brl.nullable().optional(),
          total_brl: brl.nullable().optional().describe("checkout total when shown"),
          cheapest_comparable_brl: brl.nullable().optional().describe("cheapest total seen for the same purchase, for layer 3")
        })
      },
      async (input) => json(priceBreakdown(input))
    );

    server.registerTool(
      "item_cost",
      {
        title: "Raio-X do preço",
        description:
          "Normalized cost views of one menu item from its title and price: per 100 ml, per litre, per 100 g, the real per-100 ml with fees, the fees expressed in product, per person, the shown discount, and burger meat grams/type when the title says.",
        inputSchema: z.object({
          title: z.string().min(1).max(300),
          price_brl: brl,
          original_price_brl: brl.nullable().optional().describe("struck price, if shown"),
          servings_text: z.string().max(80).nullable().optional().describe('e.g. "Serve 2 pessoas"'),
          fees_brl: brl.nullable().optional().describe("delivery + service fees to spread over this item")
        })
      },
      async (input) => json(itemCost(input))
    );

    server.registerTool(
      "rank_menu",
      {
        title: "Tamanho que compensa",
        description:
          "Rank a shop's menu: açaí per 100 ml (potes apart), burgers per 100 g of meat with what each combo charges for its extras, and every drink per litre within its kind (packs count all units).",
        inputSchema: z.object({
          items: z.array(z.object({ title: z.string().min(1).max(300), price_brl: brl })).min(1).max(400),
          kind: z.enum(["auto", "acai", "burger", "drinks"]).optional()
        })
      },
      async (input) => json(rankMenu(input))
    );

    server.registerTool(
      "advise",
      {
        title: "Pesquisa no cardápio",
        description:
          'Answer a purchase request in Portuguese (e.g. "quero açaí 500ml até R$25", "quero hamburguer até R$40") from menus your agent read: cheapest estimated checkout for the asked size, the closest size within budget, the best price per litre / per 100 g of meat, and a link to the item. Estimates only; confirm in the bag.',
        inputSchema: z.object({
          request: z.string().min(3).max(200),
          menus: z
            .array(
              z.object({
                merchant_name: z.string().min(1).max(160),
                merchant_url: z.string().url().max(400).nullable().optional().describe("iFood shop link /delivery/<city>/<shop>/<id>"),
                delivery_fee_brl: brl.nullable().describe("as shown on the shop page; null if unknown"),
                observed_at: z.string().datetime().nullable().optional(),
                items: z.array(z.object({ title: z.string().min(1).max(300), price_brl: brl, item_url: z.string().url().max(500).nullable().optional() })).min(1).max(400)
              })
            )
            .min(1)
            .max(60)
        })
      },
      async (input) => json(advise(input))
    );

    server.registerTool(
      "parse_ifood_link",
      {
        title: "Ler link do iFood",
        description: "Read an iFood shop or item link into city, shop slug, shop id and item id. Any other query value (tokens, tracking) is dropped.",
        inputSchema: z.object({ url: z.string().max(1000) })
      },
      async ({ url }) => json(parseIfoodLink(url))
    );

    server.registerTool(
      "read_menu_text",
      {
        title: "Ler cardápio (texto)",
        description:
          "Paste the visible text of a delivery shop page (iFood shop pages open without login). Returns the structured menu — items with current and struck prices and servings, delivery fee, minimum order — plus a per-litre / per-100 g summary. Feed `menu` to `advise`.",
        inputSchema: z.object({
          text: z.string().min(20).max(120_000).describe("page text as the user sees it; no account data needed"),
          shop_name: z.string().max(160).nullable().optional(),
          shop_url: z.string().max(1000).nullable().optional().describe("the shop link, for item links and the shop id")
        })
      },
      async (input) => json(readMenuFromText(input))
    );

    server.registerTool(
      "read_bag_text",
      {
        title: "Ler sacola (texto)",
        description: "Paste the visible text of a bag or checkout. Returns the lines, subtotal, fees, discount and total, checks they add up, and splits it into the 3 layers.",
        inputSchema: z.object({
          text: z.string().min(10).max(40_000),
          cheapest_comparable_brl: brl.nullable().optional()
        })
      },
      async (input) => json(readBagFromText(input))
    );

    server.registerTool(
      "compare_bags",
      {
        title: "Comparar sacolas",
        description:
          "Compare real bags for the same purchase (different shops or platforms). Ranked by total, each split into the 3 layers, where layer 3 is the difference to the cheapest bag. Use the same items and quantities.",
        inputSchema: z.object({
          bags: z
            .array(
              z.object({
                label: z.string().min(1).max(160).describe('e.g. "Maranata Açaí · iFood"'),
                food_brl: brl,
                delivery_fee_brl: brl.nullable().optional(),
                service_fee_brl: brl.nullable().optional(),
                discount_brl: brl.nullable().optional(),
                total_brl: brl,
                link: z.string().max(1000).nullable().optional()
              })
            )
            .min(2)
            .max(20)
        })
      },
      async (input) => json(compareBags(input))
    );

    server.registerPrompt(
      "pesquisar_delivery",
      {
        title: "Pesquisar delivery com o UPAY3FOOD",
        description: "Step-by-step research of a delivery purchase: read shop pages, compare per litre / per 100 g, recommend with a link. Never orders or pays.",
        argsSchema: z.object({ pedido: z.string().describe('e.g. "quero açaí 500ml até R$25"') })
      },
      ({ pedido }) => ({
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `Pedido: ${pedido}`,
                "1. Abra 3 a 5 lojas relevantes no iFood (páginas de loja abrem sem login) e copie o texto visível de cada uma.",
                "2. Para cada loja, chame `read_menu_text` com o texto, o nome e o link da loja.",
                "3. Chame `advise` com o pedido e os `menu` retornados.",
                "4. Responda com: o mais barato no tamanho pedido (total estimado e link), o tamanho mais próximo se não houver, e o melhor custo por litro / por 100 g.",
                "5. Se o usuário montar sacolas, use `read_bag_text` em cada uma e `compare_bags` para a diferença real (camada 3).",
                "Regras: só leia o que está na tela; não faça pedido nem pagamento; não envie endereço ou dados pessoais; diga que é estimativa até a sacola."
              ].join("\n")
            }
          }
        ]
      })
    );

    server.registerTool(
      "methodology",
      { title: "Metodologia", description: "How every UPAY3FOOD number is computed and what is never claimed.", inputSchema: z.object({}) },
      async () => ({ content: [{ type: "text" as const, text: METHODOLOGY_TEXT }] })
    );
  },
  {
    serverInfo: {
      name: "upay3food",
      title: "UPAY3FOOD",
      version: "0.2.0",
      websiteUrl: "https://upay3food.com/agentes",
      icons: [
        { src: "https://upay3food.com/icon-512.png", mimeType: "image/png", sizes: ["512x512"] },
        { src: "https://upay3food.com/icon-192.png", mimeType: "image/png", sizes: ["192x192"] }
      ]
      // mcp-handler types serverInfo as { name, version } but passes it whole to the SDK,
      // which sends title, websiteUrl and icons (MCP 2025-11-25 Implementation).
    } as { name: string; version: string },
    instructions:
      "UPAY3FOOD shows what you really pay for delivery food in Brazil: food, fees and the difference to the cheapest option. Read prices from pages the user can see (iFood shop pages work without login); never automate checkout or payment. Results are estimates until the bag confirms them."
  }
);

export { handler as GET, handler as POST, handler as DELETE };
