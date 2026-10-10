# Plug your own agent (MCP)

UPAY3FOOD exposes its calculations as a public MCP server, so any agent can
use them: Claude, ChatGPT, Cursor, Claude Code, or your own.

- **URL:** `https://upay3food.com/api/mcp` (Streamable HTTP, stateless, no auth)
- **Code:** `apps/web/src/app/api/mcp/route.ts` (built with `mcp-handler`);
  the tools live in `apps/web/src/lib/agent-tools.ts` and are tested.
- **Human page:** https://upay3food.com/agentes · **llms.txt:** https://upay3food.com/llms.txt

## Tools

| Tool | Input (BRL) | Output |
|---|---|---|
| `price_breakdown` | food, delivery, service, discount, total, cheapest comparable | the 3 layers, fee share, estimate flags |
| `item_cost` | title, price, struck price, servings text, fees | per 100 ml / litre / 100 g, 100 ml with fees, fees in ml of product, per person, discount, burger meat grams/type |
| `rank_menu` | menu items | açaí per 100 ml (potes apart), burgers per 100 g of meat + combo extras, drinks per litre by kind |
| `advise` | request in pt-BR + menus the agent read | cheapest estimated checkout for the size, nearest size within budget, best per litre, link to the item |
| `parse_ifood_link` | URL | city, shop slug, shop id, item id; drops every other query value |
| `methodology` | — | the rules, link to [price calculations](price-calculations.md) |

## Data and trust

- The server **stores nothing** and **never fetches** iFood or any other
  platform (ADR-007). It only computes with what the agent sends.
- No personal data is needed: titles, prices, fees and public shop links.
- Every menu-based answer is an estimate with a caveat, and the formulas are
  the same ones the extension uses ([methodology](price-calculations.md)).
- Agents are told in the server instructions to read only what the user can
  see and never to place orders or pay.

## Extension → agent

The popup's **Copiar para o seu agente** button copies the menus read in the
last 24 h, in the `advise` argument shape (reais, shop and item links), with
a short instruction. Paste it into an agent that has the connector.

## Next

- Optional OAuth for per-user history (only if users ask for it).
- A `compare_platforms` tool once other platforms' pages are calibrated.
