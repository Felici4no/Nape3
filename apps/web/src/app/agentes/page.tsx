import Link from "next/link";
import styles from "./agentes.module.css";

export const metadata = {
  title: "Para agentes",
  description: "Plugue seu agente (Claude, ChatGPT, Cursor) no UPAY3FOOD: preço real do delivery, por litro e por grama, via MCP."
};

const URL_MCP = "https://upay3food.com/api/mcp";

const CLIENTS = [
  { name: "Claude (claude.ai e app)", how: "Configurações → Conectores → Adicionar conector personalizado → cole a URL." , code: URL_MCP },
  { name: "Claude Code", how: "No terminal:", code: `claude mcp add --transport http upay3food ${URL_MCP}` },
  { name: "Cursor / VS Code / Windsurf", how: "No mcp.json do editor:", code: `{\n  "mcpServers": {\n    "upay3food": { "url": "${URL_MCP}" }\n  }\n}` },
  { name: "ChatGPT", how: "Com o modo de desenvolvedor ligado: Configurações → Conectores → Criar → cole a URL.", code: URL_MCP },
  { name: "Clientes só com stdio", how: "Via mcp-remote:", code: `npx -y mcp-remote ${URL_MCP}` }
];

const TOOLS = [
  ["price_breakdown", "Você paga 3 vezes", "comida, taxas e a diferença para o mais barato; taxas no total"],
  ["item_cost", "Raio-X do preço", "por 100 ml, litro, 100 g, por pessoa, 100 ml com taxas, taxas em ml do produto, gramas de carne"],
  ["rank_menu", "Tamanho que compensa", "cardápio por 100 ml ou por 100 g de carne, potes à parte, combos, bebidas por litro"],
  ["advise", "Pesquisa no cardápio", "“quero açaí 500ml até R$25” → total estimado, tamanho mais próximo, melhor por litro, link do item"],
  ["parse_ifood_link", "Ler link do iFood", "cidade, loja, id da loja e do item; descarta tokens e rastreio"],
  ["methodology", "Metodologia", "como cada número é calculado e o que nunca afirmamos"]
];

export default function Agentes() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className="wrap">
          <span className={styles.kicker}>MCP · aberto · sem login · sem guardar nada</span>
          <h1 className={`display ${styles.title}`}>Plugue o seu agente no preço real do delivery.</h1>
          <p className={styles.lede}>
            O seu agente lê o cardápio ou a sacola; o UPAY3FOOD devolve as 3 camadas do preço, o custo por litro e por grama, o ranking do cardápio e uma recomendação com
            link para o item. As mesmas contas da extensão, com metodologia pública.
          </p>
          <div className={styles.url}>
            <span className={styles.urlLabel}>URL do conector</span>
            <code className="num">{URL_MCP}</code>
          </div>
        </div>
      </section>

      <section className="wrap">
        <h2 className={`display ${styles.h2}`}>Conectar</h2>
        <div className={styles.clients}>
          {CLIENTS.map((c) => (
            <article key={c.name} className={styles.client}>
              <strong>{c.name}</strong>
              <p className="muted">{c.how}</p>
              <pre className={styles.code}><code>{c.code}</code></pre>
            </article>
          ))}
        </div>
        <p className="muted small">Os nomes dos menus mudam entre versões de cada app; o que vale é adicionar um servidor MCP remoto por URL (Streamable HTTP).</p>
      </section>

      <section className="wrap">
        <h2 className={`display ${styles.h2}`}>Ferramentas</h2>
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
          <h2 className={`display ${styles.h2}`}>Extensão + agente</h2>
          <ol>
            <li>Abra algumas lojas no iFood com a <Link href="/instalar">extensão</Link> — não precisa estar logado.</li>
            <li>No popup, peça “quero açaí 500ml até R$25” e clique em <b>Copiar para o seu agente</b>.</li>
            <li>Cole no seu agente com o conector UPAY3FOOD ligado. Ele chama <code>advise</code> com os cardápios que você leu e responde com o link do item.</li>
          </ol>
          <pre className={styles.code}><code>{`Pesquise para mim: "quero açaí 500ml até R$25".
Use o servidor MCP do UPAY3FOOD, ferramenta advise,
com estes cardápios que eu li no iFood…`}</code></pre>
        </div>
      </section>

      <section className={`wrap ${styles.rules}`}>
        <h2 className={`display ${styles.h2}`}>Regras para agentes</h2>
        <ul>
          <li>Leia só o que o usuário pode ver. Páginas de loja do iFood abrem sem login.</li>
          <li>Nunca finalize pedido nem pague: o UPAY3FOOD recomenda, o usuário confirma na sacola.</li>
          <li>Nada de cookies, tokens, endereço ou dados pessoais nas chamadas: as ferramentas não precisam deles.</li>
          <li>Todo resultado de cardápio é estimativa. Cupons, Clube e endereço mudam o preço.</li>
        </ul>
        <p className="muted small">
          O servidor não guarda nada e não acessa nenhuma plataforma: só calcula com o que o agente envia. <Link href="/docs/05-architecture/agents">Documentação técnica</Link> · <Link href="/llms.txt">llms.txt</Link>
        </p>
      </section>
    </div>
  );
}
