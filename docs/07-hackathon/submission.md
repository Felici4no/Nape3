# Submission — Crypto World's Fair (Colosseum)

Updated 2026-10-10. Everything needed to fill each form, copy-paste ready.

## Deadline

| Where | Closes | We aim for |
|---|---|---|
| Colosseum main submission | Oct 12, 23:59 PT (Oct 13, 06:59 UTC) | **Sunday Oct 12, 18:00 Brasília** |
| Superteam Brasil wiki says | Oct 12, 23:59 Brasília (Oct 13, 02:59 UTC) | ← safest cutoff |
| Superteam Earn sidetracks | Oct 13, 06:59 UTC | same day as above |

## Every prize we enter (one project)

| Prize | Pool | How | Fit |
|---|---|---|---|
| Colosseum Grand Prize / top 20 | $30k / 20 × $15k | Colosseum form | open, very competitive |
| **Solana ecosystem track** | 10 × $10k (on top of global) | Colosseum form | strong: USDC + Cloak shield on mainnet, memo anchors, RPC Fast |
| **University Prize** | $5k | Colosseum form; state student status and university in team fields | strong if eligible (criteria not published; email hackathon@colosseum.com if unsure) |
| **Public Good Prize** | $5k | Colosseum form | public MCP server, open methodology anchored on Solana, open source |
| **Superteam Brasil × SolarEcoFund** | 5,000 USDG | separate Earn submission; base country = Brazil on Colosseum | strong |
| **RPC Fast Infrastructure** | ~$10.5k in RPC credits (21 teams) | separate Earn submission + RPC Fast form; follow @rpcfast, join their Telegram/Discord, 2–3 posts/month for 2 months | strong technically (all on-chain traffic goes through RPC Fast) |
| Solami "live on Solana data" | 3,000 USDG | Earn; needs a Solami data path + live mainnet video | only if time allows (not built) |

Not eligible: other regional tracks (residents only), CertiK / Adevar (need an
on-chain program), Meteora, Panta, peaq. Tempo/Base tracks need another chain.
Sources: [sidetrack research](benchmark.md), solanabr/wiki PR #3, SuperteamDAO/earn FAQ.

## Fields

**Project name:** UPAY3FOOD

**One-liner (EN):** You pay three times for delivery food — the food, the fees and the difference to the cheapest option. UPAY3FOOD shows all three on iFood, ranks the menu per litre and per gram, outlines the item worth buying, and lets any AI agent do the same through a public MCP server; the rules are anchored on Solana.

**One-liner (PT):** Você paga 3 vezes pela comida. O UPAY3FOOD mostra as três no iFood, compara o cardápio por litro e por grama, marca o item que compensa e deixa qualquer agente de IA fazer o mesmo via MCP; as regras ficam registradas na Solana.

**Problem.** Brazil's delivery market is in a subsidy war (iFood ~R$24 bn, Keeta R$5.6 bn, 99Food R$2 bn). Menu prices hide what you pay: delivery and service fees, coupons and sizes that are not comparable. No platform exposes consumer checkout prices through an API, and in 2026 Senacon started requiring price breakdowns. A 300 ml cup and a 700 ml bowl look similar on the menu; per litre one costs 46% more.

**Solution.**
- **Browser extension** that reads the user's own page, observe-only:
  - "Você paga 3 vezes": food, fees and the difference;
  - "Raio-X do preço": per 100 ml, per litre, per 100 g, per person, and the fees expressed in product;
  - "Tamanho que compensa": the whole menu ranked per litre or per 100 g of meat, with combo extras priced;
  - every drink per litre within its kind;
  - outlines of the best item on iFood's own menu.
- **Explainable agent** ("quero açaí 500ml até R$25"): the cheapest estimated checkout, the nearest size, and a link straight to the item.
- **Public MCP server** (`https://upay3food.com/api/mcp`, 9 tools + 1 prompt) so Claude, ChatGPT or Cursor can read shop pages and get the same answers.
- **Solana:**
  - USDC funding shielded through Cloak (1 USDC shielded on mainnet, slot 453687294);
  - the methodology and calculation code hashed and anchored on mainnet via SPL Memo (/transparencia);
  - all RPC traffic through RPC Fast.

**How Solana is used (be concrete).**
1. Private funding:
   - USDC shield into Cloak from Phantom, signature `4xa8vKZL…asQfx` ([proof](../08-proofs/2026-10-05-mainnet-shield.md));
   - a relay guard enforces one signature, no wallet-funded lookup tables, and fresh quotes.
2. Transparency anchor:
   - SHA-256 of `price-calculations.md` and of the engine sources, written as an SPL Memo;
   - anyone can verify it on /transparencia or with `sha256sum`.
3. RPC Fast:
   - the same-origin proxy (`/api/solana-rpc`) has a method allowlist and failure classification;
   - no key reaches the browser.

**Tech.** TypeScript monorepo (pnpm):
- Chrome MV3 extension (React);
- Next.js 16 site on Vercel;
- MCP server (`mcp-handler`, Streamable HTTP);
- `@solana/kit` + web3.js and `@cloak.dev/sdk`;
- private Vercel Blob for the dev bridge;
- 493 tests (vitest);
- regression fixtures derived from real sanitized iFood captures (commercial data only).

**Open source.** https://github.com/Felici4no/Nape3-UPAY3FOOD — confirm the repository is **public** before submitting.

**Prior work / third-party code (disclose).**
- The repository was created on 2026-10-03, inside the hackathon window, and all ~130 commits are from then on.
- Third-party code: `@cloak.dev/sdk` (used as a dependency, with adapter code in `packages/payments/src/cloak`), `mcp-handler`, `@solana/kit`, `@solana/web3.js`, fontsource fonts.

**Team.** Solo builder, Brazilian university student [course / university], a daily iFood user. Plan after the hackathon: keep building full-time, with a first hire for data partnerships.

**Business model (hypotheses, see [report](../06-business/business-model-and-pitch.pt-BR.md)).**
1. Free for consumers.
2. Revenue now: a CPA per verified first order routed to entrant platforms (Keeta, 99Food, Rappi), cheaper than the R$99–250 coupons they spend today, with the same terms offered to all platforms and disclosed in the UI.
3. Revenue later: aggregated, auditable price data for restaurants, funds and alt-data vendors.
4. Neutrality rules come from three precedents: Taxômetro (2026), Trivago (A$44.7 m) and Honey.

**Go-to-market.**
- University communities and Superteam Brasil first (students order delivery often and are price-sensitive).
- Then creators who compare delivery prices.
- The MCP server reaches users of AI agents with zero distribution cost.

**Traction (fill only with measured numbers).** Testers [N] · shops read [X] · items compared [Y] · estimated savings [R$Z] (popup → "Seus números" → "Copiar meus números").

**Links.**
- Site: https://upay3food.com
- Install: https://upay3food.com/instalar
- Agents: https://upay3food.com/agentes
- Transparency: https://upay3food.com/transparencia
- Docs: https://docs.upay3food.com
- MCP: https://upay3food.com/api/mcp

**Videos.** Pitch (≤ 3 min) and technical demo (≤ 3 min): [video scripts](video-scripts.md).

## Checklist

- [ ] Repository public
- [ ] Colosseum: project registered, base country Brazil, student status in team fields
- [ ] Transparency anchor signed on mainnet (/transparencia) and its signature added to `apps/web/src/data/anchors.json`
- [ ] 10+ testers via /instalar; numbers collected with "Copiar meus números"
- [ ] Pitch video and demo video uploaded (hide the iFood delivery address)
- [ ] Colosseum form submitted
- [ ] Earn: Superteam Brasil × SolarEcoFund submitted
- [ ] Earn: RPC Fast submitted (+ follow, community, posts)
