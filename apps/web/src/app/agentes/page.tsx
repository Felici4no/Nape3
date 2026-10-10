import Link from "next/link";
import styles from "./agentes.module.css";

export const metadata = {
  title: "For agents",
  description: "Plug your agent (Claude, ChatGPT, Cursor) into UPAY3FOOD: the real price of delivery food, per litre and per gram, over MCP."
};

const URL_MCP = "https://upay3food.com/api/mcp";

const CLIENTS = [
  { name: "Claude (claude.ai and apps)", how: "Settings → Connectors → Add custom connector → paste the URL.", code: URL_MCP },
  { name: "On your phone (Claude app)", how: "Add the connector once on claude.ai and it shows up in the app. Send a screenshot of an iFood menu and ask:", code: "Read this screenshot and use UPAY3FOOD: which açaí is the best value per litre?" },
  { name: "Claude Code", how: "In the terminal:", code: `claude mcp add --transport http upay3food ${URL_MCP}` },
  { name: "Cursor / VS Code / Windsurf", how: "In the editor's mcp.json:", code: `{\n  "mcpServers": {\n    "upay3food": { "url": "${URL_MCP}" }\n  }\n}` },
  { name: "ChatGPT", how: "With developer mode on: Settings → Connectors → Create → paste the URL.", code: URL_MCP },
  { name: "stdio-only clients", how: "Through mcp-remote:", code: `npx -y mcp-remote ${URL_MCP}` }
];

const TOOLS = [
  ["price_breakdown", "You pay 3 times", "food, fees and the difference to the cheapest option; the fees' share of the total"],
  ["item_cost", "Price X-ray", "per 100 ml, per litre, per 100 g, per person, per 100 ml with fees, the fees in ml of the product, grams of meat"],
  ["rank_menu", "The size worth buying", "the menu per 100 ml or per 100 g of meat, tubs apart, combos, drinks per litre"],
  ["advise", "Menu search", "“açaí 500 ml under R$25” → estimated total, nearest size, best per litre, link to the item"],
  ["read_menu_text", "Read a menu (text)", "paste the shop page text → items, struck-through prices, servings, delivery fee and a per-litre summary"],
  ["read_bag_text", "Read a bag (text)", "paste the bag text → lines, fees, a checked total and the 3 layers"],
  ["compare_bags", "Compare bags", "real bags for the same purchase → ranking and the real difference to the cheapest"],
  ["parse_ifood_link", "Read an iFood link", "city, shop, shop and item ids; drops tokens and tracking"],
  ["methodology", "Methodology", "how each number is computed and what we never claim"]
];

export default function Agentes() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className="wrap">
          <span className={styles.kicker}>MCP · open · no login · stores nothing</span>
          <h1 className={`display ${styles.title}`}>Plug your agent into the real price of delivery.</h1>
          <p className={styles.lede}>
            Your agent reads the menu or the bag; UPAY3FOOD returns the 3 layers of the price, the cost per litre and per gram, the menu ranking and a recommendation with a
            link to the item. The same math as the extension, with a public methodology.
          </p>
          <div className={styles.url}>
            <span className={styles.urlLabel}>Connector URL</span>
            <code className="num">{URL_MCP}</code>
          </div>
        </div>
      </section>

      <section className="wrap">
        <h2 className={`display ${styles.h2}`}>Connect</h2>
        <div className={styles.clients}>
          {CLIENTS.map((c) => (
            <article key={c.name} className={styles.client}>
              <strong>{c.name}</strong>
              <p className="muted">{c.how}</p>
              <pre className={styles.code}><code>{c.code}</code></pre>
            </article>
          ))}
        </div>
        <p className="muted small">There is also a <code>pesquisar_delivery</code> prompt that walks the agent through a search. Menu names change between app versions; what matters is adding a remote MCP server by URL (Streamable HTTP).</p>
      </section>

      <section className="wrap">
        <h2 className={`display ${styles.h2}`}>Tools</h2>
        <table className={styles.tools}>
          <tbody>
            {TOOLS.map(([id, name, what]) => (
              <tr key={id}>
                <td><code className="num">{id}</code></td>
                <td><strong>{name}</strong></td>
                <td className="muted">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={styles.flow}>
        <div className="wrap">
          <h2 className={`display ${styles.h2}`}>Extension + agent</h2>
          <ol>
            <li>Open a few iFood shops with the <Link href="/instalar">extension</Link>. No login needed.</li>
            <li>In the popup, ask “quero açaí 500ml até R$25” (açaí 500 ml under R$25) and click <b>Copiar para o seu agente</b> (copy for your agent).</li>
            <li>Paste it into your agent with the UPAY3FOOD connector on. It calls <code>advise</code> with the menus you read and answers with the link to the item.</li>
          </ol>
          <pre className={styles.code}><code>{`Search for me: "açaí 500 ml under R$25".
Use the UPAY3FOOD MCP server, tool advise,
with these menus I read on iFood…`}</code></pre>
        </div>
      </section>

      <section className={`wrap ${styles.rules}`}>
        <h2 className={`display ${styles.h2}`}>Rules for agents</h2>
        <ul>
          <li>Read only what the user can see. iFood shop pages open without login.</li>
          <li>Never place an order or pay: UPAY3FOOD recommends, the user confirms in the bag.</li>
          <li>No cookies, tokens, addresses or personal data in the calls: the tools do not need them.</li>
          <li>Every menu result is an estimate. Coupons, membership and address change the price.</li>
        </ul>
        <p className="muted small">
          The server stores nothing and calls no platform: it only computes with what the agent sends. <Link href="/docs/05-architecture/agents">Technical docs</Link> · <Link href="/llms.txt">llms.txt</Link>
        </p>
      </section>
    </div>
  );
}
