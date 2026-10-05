"use client";

import "@nape3/pay/polyfills";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cents } from "@nape3/domain";
import { formatUsdcDisplay } from "@nape3/payments";
import { findWallet, isUserRejection, WalletSession, type WalletSnapshot } from "@nape3/pay";
import { brl, shortAddress } from "@/lib/format";
import styles from "./money.module.css";

export interface ReferencePurchase {
  slug: string;
  name: string;
  cents: number;
  /** Median from the synthetic demo market, not real observations. */
  synthetic: boolean;
}

const STATE_COPY: Record<string, string> = {
  WALLET_REQUIRED: "Connect a wallet to fund purchases.",
  WALLET_CONNECTED: "Connected. Sign once to read your private balance.",
  FUNDS_CHECKED: "Balances checked.",
  SHIELD_REQUIRED: "Shield more USDC before paying this purchase.",
  PAYMENT_READY: "Your private balance covers this purchase."
};

export default function WalletScreen({ references }: { references: ReferencePurchase[] }) {
  const session = useMemo(() => new WalletSession(), []);
  const [snap, setSnap] = useState<WalletSnapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState(references[0]?.slug ?? "");
  const wallet = typeof window === "undefined" ? null : findWallet();
  const reference = references.find((r) => r.slug === ref);

  useEffect(() => {
    session.connect(true).then(setSnap).catch(() => undefined); // silent: only if already trusted
  }, [session]);

  async function act(label: string, fn: () => Promise<WalletSnapshot | null>) {
    setBusy(label);
    setError(null);
    try {
      const next = await fn();
      if (next) setSnap(next);
    } catch (e) {
      setError(isUserRejection(e) ? "Cancelled in the wallet." : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const state = snap?.agentState ?? "WALLET_REQUIRED";
  const a = snap?.assessment;

  return (
    <div className={`wrap ${styles.page}`}>
      <div className={`night ${styles.sheet}`}>
        <span className={`eyebrow ${styles.eyebrow}`}>Wallet · Solana mainnet · USDC</span>
        <h1 className={`display ${styles.h1}`}>Your money, two balances.</h1>
        <p className={styles.lede}>Public USDC sits in your wallet. Private (shielded) USDC sits in Cloak and is what funds purchases.</p>

        <span className={`${styles.state} ${state === "PAYMENT_READY" ? styles.ok : state === "WALLET_REQUIRED" ? styles.off : ""}`}>
          <i /> {state}
        </span>
        <p className="small" style={{ color: "var(--night-ink-2)" }}>{STATE_COPY[state]}</p>

        {!snap ? (
          <div className={styles.row}>
            <button className="btn light" disabled={!!busy || !wallet} onClick={() => act("Approve in your wallet…", () => session.connect(false))}>
              {wallet ? `Connect ${wallet.name}` : "Install Phantom or Solflare"}
            </button>
          </div>
        ) : (
          <>
            <div className={styles.card}>
              <div className="kv"><span>{snap.name}</span><span className="num" title={snap.address}>{shortAddress(snap.address)}</span></div>
              <div className="kv"><span>Public USDC</span><span className={`num ${styles.strong}`}>{snap.publicUsdc === null ? "—" : formatUsdcDisplay(snap.publicUsdc)}</span></div>
              <div className="kv"><span>Private USDC (Cloak)</span><span className={`num ${styles.strong}`}>{snap.shieldedUsdc === null ? "locked" : formatUsdcDisplay(snap.shieldedUsdc)}</span></div>
              <div className="kv"><span>SOL for fees</span><span className="num">{snap.solLamports === null ? "—" : `${(Number(snap.solLamports) / 1e9).toFixed(4)} SOL`}</span></div>
            </div>

            {references.length > 0 && (
              <label className="small" style={{ display: "grid", gap: 6 }}>
                Check readiness for
                <select className={styles.select} value={ref} onChange={(e) => setRef(e.target.value)}>
                  {references.map((r) => <option key={r.slug} value={r.slug}>{r.name} · {r.synthetic ? "demo median" : "market median"} {brl(r.cents)}</option>)}
                </select>
              </label>
            )}

            <div className={styles.row}>
              <button
                className="btn light"
                disabled={!!busy}
                onClick={() =>
                  act("Sign once in your wallet (not a transaction)…", () =>
                    session.check({ includePrivate: true, ...(reference ? { referenceCents: cents(reference.cents) } : {}) })
                  )
                }
              >
                {snap.shieldedUsdc === null ? "Unlock private balance" : "Refresh balances"}
              </button>
              <button className="btn ghost" style={{ color: "var(--night-ink)", boxShadow: "inset 0 0 0 1.5px var(--night-ink)" }} onClick={() => act("Disconnecting…", async () => { await session.disconnect(); setSnap(null); return null; })}>
                Disconnect
              </button>
            </div>

            {a && reference && (
              <div className={styles.card}>
                {a.kind === "ready" ? (
                  <span className={styles.okText}>Ready: your private balance covers {reference.name} at {brl(reference.cents)}.</span>
                ) : a.canShield ? (
                  <span>Shield {formatUsdcDisplay(a.shieldAmountUsdc)} more to pay {reference.name} privately. You can do it from the Pay screen.</span>
                ) : a.reason === "insufficient-public-usdc" ? (
                  <span className={styles.err}>Add {formatUsdcDisplay(a.addPublicUsdc)} USDC to this wallet first.</span>
                ) : (
                  <span className={styles.err}>Add about 0.01 SOL for network fees first.</span>
                )}
              </div>
            )}
          </>
        )}

        {busy && <p className={styles.status}>{busy}</p>}
        {error && <p className={`${styles.status} ${styles.err}`}>{error}</p>}

        <p className={styles.fine}>
          UPAY3FOOD never asks for your seed phrase or private key. One wallet signature unlocks your private balance on this device; it is
          not a transaction. <Link href="/shield">Shield 1 USDC →</Link> · <Link href="/privacy">What stays private →</Link>
        </p>
      </div>
    </div>
  );
}
