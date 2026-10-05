"use client";

import "@nape3/pay/polyfills";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createShieldSession, findWallet } from "@nape3/pay";
import { shortAddress } from "@/lib/format";
import { ShieldDiagnostics } from "./ShieldDiagnostics";
import styles from "./money.module.css";

/**
 * /shield/diagnose: investigation only. There is no shield action on this
 * page: it connects the wallet, reads chain state and simulates the shield
 * without broadcasting. It works on any deployment URL, whether or not this
 * origin holds the blocking attempt record (which lives in localStorage).
 */
export default function ShieldDiagnoseScreen() {
  const session = useMemo(() => createShieldSession(), []);
  const [wallet, setWallet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasWallet = typeof window === "undefined" ? false : findWallet() !== null;

  useEffect(() => {
    session
      .connectForDiagnosis(true)
      .then(setWallet)
      .catch(() => undefined); // silent reconnect only
  }, [session]);

  async function connect() {
    setError(null);
    try {
      setWallet(await session.connectForDiagnosis(false));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className={`wrap ${styles.page}`}>
      <div className={`night ${styles.sheet}`}>
        <span className={`eyebrow ${styles.eyebrow}`}>Shield diagnosis · Solana mainnet-beta · read-only and simulate-only</span>
        <h1 className={`display ${styles.h1}`}>Why did the shield fail?</h1>
        <p className={styles.fine}>
          Nothing on this page can send a transaction. Reading chain state needs no signature. Simulating asks your wallet for the Cloak unlock message
          (a message, not a transaction) once, then builds the same shield and only simulates it.
        </p>
        {wallet ? (
          <p className={styles.status}>Wallet {shortAddress(wallet)}</p>
        ) : (
          <div className={styles.row}>
            <button className="btn light" disabled={!hasWallet} onClick={() => void connect()}>
              {hasWallet ? "Connect wallet" : "No Solana wallet found"}
            </button>
          </div>
        )}
        {error && <p className={`${styles.status} ${styles.err}`}>{error}</p>}
        {wallet && <ShieldDiagnostics session={session} />}
        <p className={styles.fine}>
          <Link href="/shield">Back to /shield</Link>
        </p>
      </div>
    </div>
  );
}
