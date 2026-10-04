import type { Metadata } from "next";
import Link from "next/link";
import { PRIVACY_COPY } from "@nape3/payments/privacy-copy";
import styles from "./privacy.module.css";

export const metadata: Metadata = { title: "Privacy" };

const FLOW = [
  { label: "Your wallet", note: "public", visible: true },
  { label: "Shield into Cloak", note: "deposit visible: wallet, amount, time", visible: true },
  { label: "Cloak shielded pool", note: "which note paid what: hidden", visible: false },
  { label: "Unshield to off-ramp", note: "amount and time visible, not your wallet", visible: true },
  { label: "Pix to the merchant", note: "a normal Pix: not private", visible: true }
];

const WHO = [
  ["Public chain observers, analytics, other users", "No"],
  ["Off-ramp / Pix recipient", "No: funds arrive from the pool (it still sees the Pix and, under KYC, knows its customer)"],
  ["Merchant, iFood", "Never saw your wallet; unchanged"],
  ["Cloak relay (compliance, registered viewing key)", "Yes, by design"],
  ["Anyone with your viewing key or note file", "Yes, so they are never logged, uploaded or shown"]
];

export default function PrivacyPage() {
  return (
    <div className={`night ${styles.page}`}>
      <div className="wrap">
        <span className="eyebrow">Private payment · Cloak on Solana</span>
        <h1 className={`display ${styles.h1}`}>{PRIVACY_COPY.headline}</h1>
        <p className={styles.lede}>
          Cloak hides one thing very well: the on-chain link between your wallet and what you buy. It does not make Pix private and it does
          not hide amounts entering or leaving the pool. Here is exactly where the line is.
        </p>

        <ol className={styles.flow}>
          {FLOW.map((step, i) => (
            <li key={step.label} className={step.visible ? styles.visible : styles.hidden}>
              <span className={`num ${styles.n}`}>{i + 1}</span>
              <strong>{step.label}</strong>
              <span>{step.note}</span>
            </li>
          ))}
        </ol>

        <div className={styles.cols}>
          <section>
            <h2 className="display">Hidden</h2>
            <ul>
              <li>The link between your wallet and the purchase: the off-ramp is paid from the shared pool.</li>
              <li>Which deposit funded which payment, and your shielded balance itself.</li>
              <li>Your wallet history and balances, from whoever receives the payment.</li>
            </ul>
          </section>
          <section>
            <h2 className="display">Still visible</h2>
            <ul>
              <li><strong>Pix is not private.</strong> The off-ramp, the PSP, iFood and the merchant see the Pix payment as usual.</li>
              <li>Your shield transaction: wallet, amount, time.</li>
              <li>The unshield to the off-ramp: amount, time.</li>
              <li>Cloak's relay can see your shielded history: your viewing key is registered for compliance, by design.</li>
            </ul>
          </section>
        </div>

        <section className={styles.who}>
          <h2 className="display">Hidden from whom</h2>
          {WHO.map(([party, answer]) => (
            <div className="kv" key={party}><span>{party}</span><span>{answer}</span></div>
          ))}
        </section>

        <section className={styles.cols}>
          <div>
            <h2 className="display">Use it well</h2>
            <p>{PRIVACY_COPY.tip}</p>
            <p>The privacy has a price, shown before you confirm: Cloak's withdraw fee is 0,45 USDC + 0,3% (about 0,47 USDC on a R$27,79 order).</p>
          </div>
          <div>
            <h2 className="display">Your keys</h2>
            <p>
              No seed phrase, no private key, ever. Your wallet signs one message to derive your Cloak key; notes are encrypted on your device.
              Settlement is disabled until a licensed off-ramp is integrated.
            </p>
            <Link className="btn light" href="/wallet">Open wallet</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
