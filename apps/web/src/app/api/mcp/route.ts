import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { advise, itemCost, METHODOLOGY_TEXT, parseIfoodLink, priceBreakdown, rankMenu } from "@/lib/agent-tools";

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
      "methodology",
      { title: "Metodologia", description: "How every UPAY3FOOD number is computed and what is never claimed.", inputSchema: z.object({}) },
      async () => ({ content: [{ type: "text" as const, text: METHODOLOGY_TEXT }] })
    );
  },
  {
    serverInfo: { name: "upay3food", version: "0.1.0" },
    instructions:
      "UPAY3FOOD shows what you really pay for delivery food in Brazil: food, fees and the difference to the cheapest option. Read prices from pages the user can see (iFood shop pages work without login); never automate checkout or payment. Results are estimates until the bag confirms them."
  }
);

export { handler as GET, handler as POST, handler as DELETE };
