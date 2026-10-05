import type { Metadata } from "next";
import Link from "next/link";
import styles from "../../docs.module.css";

export const metadata: Metadata = { title: "Proof · first mainnet Cloak shield", description: "Confirmed 1.000000 USDC Cloak shield on Solana mainnet." };

const proof = {
  network: "mainnet-beta",
  amount: "1.000000 USDC",
  wallet: "9qAezschd4e5t5yi9F5SAw41g43Vuj6iYMh7dpcKqkUi",
  signature: "4xa8vKZLHQfZF6GzvK4SAqQwRrQUN9H7UBmT5cvnc6BKjiMdQ2RMJKnRVqgq7HtG4tAyUeFbcXjWXWfZ1v4asQfx",
  slot: "453687294",
  confirmedAt: "2026-10-05T20:32:11.000Z",
  program: "zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW"
} as const;

export default function MainnetShieldProofPage() {
  return <div className={styles.docs}>
    <article className={styles.proof}>
      <span className="eyebrow">CONFIRMED · SOLANA MAINNET</span>
      <h1 className="display">FIRST REAL CLOAK SHIELD.</h1>
      <p className={styles.lede}>UPAY3FOOD moved 1.000000 USDC from a Phantom wallet into the Cloak pool and reported the funds in the private balance.</p>
      <div className={styles.kvs}>
        <div className={styles.kv}><span>Amount</span><code>{proof.amount}</code></div>
        <div className={styles.kv}><span>Network</span><code>{proof.network}</code></div>
        <div className={styles.kv}><span>Slot</span><code>{proof.slot}</code></div>
        <div className={styles.kv}><span>Confirmed</span><code>{proof.confirmedAt}</code></div>
        <div className={styles.kv}><span>Wallet</span><code>{proof.wallet}</code></div>
        <div className={styles.kv}><span>Signature</span><code>{proof.signature}</code></div>
        <div className={styles.kv}><span>Cloak program</span><code>{proof.program}</code></div>
      </div>
      <div className={styles.actions}>
        <a className="btn light" href={`https://solscan.io/tx/${proof.signature}`} target="_blank" rel="noreferrer">View on Solscan</a>
        <Link className="btn ghost" href="/docs">Documentation</Link>
      </div>
    </article>
    <section className={styles.section}><span className="eyebrow">EXECUTION PATH</span><h2>What ran</h2><pre className={styles.flow}>{`Phantom
→ risk quote
→ relay-funded supplemental ALT
→ ALT warm-up
→ quote freshness checks
→ one transaction approval
→ v0 Cloak deposit
→ preflight + broadcast
→ confirmation
→ SHIELDED`}</pre></section>
    <section className={styles.section}><span className="eyebrow">PRIVACY BOUNDARY</span><h2>What this proof means</h2><p>The shield transaction is public. Cloak is used to break the later on-chain link between that public wallet deposit and a shielded withdrawal. This proof does not claim that Pix is private and does not prove merchant settlement.</p></section>
    <section className={styles.section}><span className="eyebrow">SOURCE OF RECORD</span><h2>Preserved in GitHub</h2><p>The successful proof is separate from the earlier failed-attempt incident so the project history remains auditable.</p><div className={styles.actions}><a className="btn" href="https://github.com/Felici4no/Nape3-UPAY3FOOD/blob/claude/youthful-hypatia-a3c9mn/docs/08-proofs/2026-10-05-mainnet-shield.md" target="_blank" rel="noreferrer">Canonical proof</a></div></section>
  </div>;
}