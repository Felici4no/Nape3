# Video scripts

Both videos are at most 3:00, in English, with Portuguese UI on screen. Record
the screen at 1440p.

Before recording:
- **hide the delivery address** in iFood's header (crop it, or blur it in editing);
- close other tabs.

Numbers in `[brackets]` are filled only with measured values.

## 1. Pitch (≤ 3:00) — judges watch this first

| Time | Screen | Narration |
|---|---|---|
| 0:00–0:12 | iFood shop page; the outline "★ Melhor por litro" appears on the 700 ml bowl | "Same shop, same açaí. The 300 ml cup costs 46% more per litre than the 700 ml bowl, and the menu never tells you." |
| 0:12–0:25 | Founder on camera, name and university | "I'm [name], a student in São Paulo and an everyday iFood user. I built UPAY3FOOD alone during this hackathon." |
| 0:25–0:50 | The "Você paga 3 vezes" card on a real product | "In delivery you pay three times: the food, the fees, and the difference to the cheapest option. Coupons, fees and sizes make that third layer invisible. And no platform has an API for what the consumer actually pays at checkout." |
| 0:50–1:05 | Market numbers: iFood R$24 bn, Keeta R$5.6 bn, 99Food R$2 bn; Senacon Portaria 61/2026 | "Brazil is in a delivery subsidy war, and since April the government requires price breakdowns. There has never been a better moment for a neutral price layer." |
| 1:05–1:40 | Raio-X → Tamanho que compensa → popup search "quero açaí 500ml até R$25" → recommendation → "Abrir este item" → iFood opens with the item outlined in red | "Our extension reads only what you already see. It works without login, without private APIs and without bots. It ranks the whole menu per litre and per gram of meat, and drinks per litre. Ask the agent in Portuguese and it picks the cheapest valid option, explains why, and takes you straight to the item." |
| 1:40–2:00 | Claude with the UPAY3FOOD connector answering the same question | "Any AI agent can do the same through our public MCP server. Claude or ChatGPT read the shop page, and UPAY3FOOD does the math." |
| 2:00–2:20 | /transparencia: hashes, the memo transaction on Solscan; the Cloak shield transaction | "On Solana, the rules are anchored on mainnet, so the numbers can't be quietly changed later. Funding is private: USDC is shielded through Cloak, and this is a real mainnet transaction." |
| 2:20–2:40 | Business model slide | "It's free for users. Entrant platforms pay per verified new customer, which is cheaper than the coupons they burn today. Later we sell aggregated, auditable price data. The ranking never depends on who pays." |
| 2:40–3:00 | Traction numbers, then the closing line | "[N] students tested it, read [X] shops and found [R$Z] in estimated savings. UPAY3FOOD: stop paying the third time." |

## 2. Technical demo (≤ 3:00)

| Time | What to show |
|---|---|
| 0:00–0:20 | `/instalar` → download → `chrome://extensions` → load the folder (fast-forward) |
| 0:20–0:50 | iFood shop page, logged out: the popup shows the menu read; outlines on the cards; "Bebidas por litro" |
| 0:50–1:15 | Open a product: the three layers, Raio-X ("as taxas valem 175 ml deste açaí"), the estimate label |
| 1:15–1:45 | Popup: "quero açaí 500ml até R$25" → nearest size and best per litre, "Como o agente chegou nisso" → "Ver no cardápio" scrolls and pulses |
| 1:45–2:05 | Bag: values read from the page, the "lido da página" chip, the reconciliation |
| 2:05–2:30 | Claude + MCP: `read_menu_text` with the page text → `advise` → the item link |
| 2:30–2:50 | `/transparencia` → "Verificar" ✓; Solscan for the memo and the Cloak shield |
| 2:50–3:00 | GitHub: tests passing, docs, methodology |

## Lines never to say

- "Cheapest guaranteed." Say instead: "an estimate until the bag confirms it".
- "iFood overcharges." We never claim causes.
- Any number that was not measured.
