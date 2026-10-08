# Benchmark against past winners

Research date: 2026-10-08. Most facts come from Colosseum's winner posts and
Superteam Brasil's public wiki. Colosseum's site was not reachable directly,
so items marked **unverified** need a check.

## What wins

**Judging** (Crypto World's Fair rules §8, equal weight; via a
[rules summary](https://github.com/DeveloperAlly/solana-hack/issues/1)):

- functionality and code quality;
- potential impact (TAM);
- novelty;
- UX that uses the chain well;
- open source and composability;
- business plan.

The FAQ adds founder–market fit, insight, execution speed, communication,
viability and traction. The pitch video is watched first.

Patterns in winning submissions:

- live, deployed products;
- real users or volume;
- a problem stated in the first minute;
- teams that intend to keep building.

## Comparable winners

| Project | Event and result | Why it is comparable |
| --- | --- | --- |
| **Cloak** | Cypherpunk 2025: Stablecoins #3, Superteam Brasil track #1 | Brazilian student team, private payments. It is now UPAY3FOOD's privacy layer |
| **MCPay** (Brazil) | Cypherpunk 2025: Stablecoins #1 ($25k) | Agent payments infrastructure |
| **SP3ND** | Cypherpunk 2025: Stablecoins #5 | Pay mainstream e-commerce (Amazon) with stablecoins, agent API |
| **Zoneless** | Frontier 2026: Public Good | Solo founder; won on traction (2,200+ sellers, self-reported) |
| **DashX, KinnectFi** | Frontier 2026 winners | Stablecoin payments for a specific country corridor |
| **Latinum, Mercantill** | Breakout 2025 AI #1; Cypherpunk 2025 Stablecoins #4 | Payments for agents |
| **Deks** | Breakout 2025: Consumer #5 | Consumer crypto spending (gift cards) |

Sources:

- [Cypherpunk winners](https://blog.colosseum.com/announcing-the-winners-of-the-solana-cypherpunk-hackathon/)
- [Frontier winners](https://blog.colosseum.com/announcing-the-winners-of-the-solana-frontier-hackathon/)
- [Breakout winners](https://blog.colosseum.com/announcing-the-winners-of-the-solana-breakout-hackathon/)
- [Superteam Brasil on X](https://x.com/SuperteamBR/status/2002125554984608120)
- [Zoneless numbers](https://www.indiehackers.com/post/i-cut-my-stripe-connect-fees-from-9-400-mo-to-5-590b53ddbc)

**No hackathon project comparing delivery prices was found.** Before claiming
novelty in the submission, confirm it with Colosseum Copilot's search over
past submissions.

## Where UPAY3FOOD stands

| Criterion | Today | Evidence |
| --- | --- | --- |
| Functionality | Medium | Extension, web, agent, docs; Cloak shield on mainnet. Extractors not yet calibrated on real iFood pages |
| Impact (TAM) | Medium–high | Brazilian delivery market, where iFood dominates and Keeta and 99Food are entering. Needs sourced numbers |
| Novelty | High | No comparable project found |
| Blockchain UX | Weak–medium | Comparison works without Solana. Payment stops before Pix (off-ramp disabled) |
| Open source / composability | Medium–high | Open repo, packages, Open Delivery roadmap |
| Business plan | Weak | Only hypotheses (`06-business`) |
| Traction | None | No users yet |

**Realistic targets:** the Superteam Brasil track, the University prize
(student builder), and the RPC Fast sidetrack (credits). A top-21 global
place or the Solana track is unlikely without traction and a strong video.
This is an estimate, not a measurement.

## Top gaps, in order

1. **Real data.** One real comparison from live iFood pages, captured through
   the dev bridge, then shown in the web app.
2. **Traction.** 10–50 Brazilian students using the extension: how many
   comparisons they ran, how much they could have saved (R$), quotes.
3. **Make Solana essential.** Frame funding as an agent payment with a
   spending limit: agent decision → USDC from Cloak → on-chain receipt.
   Present Pix through a licensed partner as the roadmap. Brazil's VASP
   authorization regime (since Feb 2026) explains why it is not live yet.
4. **Videos.** Pitch of 3 minutes or less: problem in 60 s, live demo,
   numbers, founder. Technical demo of 3 minutes or less.
5. **Business plan.** Revenue hypotheses (cashback / affiliate, a fee on
   settled payments, B2B price intelligence), GTM through Superteam BR and
   universities, compliance stance.
6. **Hygiene.**
   - Public repo; disclose third-party code (the adapted Cloak SDK).
   - Register separately on Earn for the Brasil and RPC Fast sidetracks.
   - Say how a solo builder will continue after the hackathon.
