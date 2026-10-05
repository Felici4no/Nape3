"use client";

import "@nape3/pay/polyfills";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  createShieldSession,
  findWallet,
  formatSol9,
  formatUsdc6,
  getRpcUrl,
  setRpcUrl,
  shieldRpc,
  type ShieldRpc,
  type ShieldState,
  type ShieldView
} from "@nape3/pay";
import { shortAddress } from "@/lib/format";
import { ShieldDiagnostics } from "./ShieldDiagnostics";
import styles from "./money.module.css";

const ORDER: ShieldState[] = [
  "WALLET_CONNECTED",
  "BALANCE_VERIFIED",
  "CLOAK_UNLOCK_REQUIRED",
  "CLOAK_READY",
  "SHIELD_PREPARED",
  "USER_CONFIRMATION_REQUIRED",
  "WALLET_SIGNATURE_REQUIRED",
  "SUBMITTING",
  "CONFIRMING",
  "SHIELDED"
];
const IN_FLIGHT: ShieldState[] = ["WALLET_SIGNATURE_REQUIRED", "SUBMITTING", "CONFIRMING"];
const ghost = { color: "var(--night-ink)", boxShadow: "inset 0 0 0 1.5px var(--night-ink)" };
const PUBLIC_DEFAULT = "api.mainnet-beta.solana.com";

export default function ShieldScreen() {
  const session = useMemo(() => createShieldSession(), []);
  const op = session.operation;
  const [view, setView] = useState<ShieldView>(op.state);
  const [rpc, setRpc] = useState("");
  const [rpcInfo, setRpcInfo] = useState<ShieldRpc | null>(null);
  const [copied, setCopied] = useState(false);
  const wallet = typeof window === "undefined" ? null : findWallet();
  const inFlight = IN_FLIGHT.includes(view.state);

  useEffect(() => op.subscribe(setView), [op]);
  useEffect(() => {
    setRpc(getRpcUrl());
    setRpcInfo(shieldRpc());
    void op.connect(true); // silent: only if this site is already trusted
  }, [op]);

  // A shield in flight must not be interrupted by a refresh or a back navigation.
  useEffect(() => {
    if (!inFlight) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [inFlight]);

  const { summary, proof, failure } = view;
  const reached = ORDER.indexOf(view.state);

  return (
    <div className={`wrap ${styles.page}`}>
      <div className={`night ${styles.sheet}`}>
        <span className={`eyebrow ${styles.eyebrow}`}>Shield · Solana mainnet-beta · USDC → Cloak</span>
        <h1 className={`display ${styles.h1}`}>Shield 1 USDC.</h1>
        <p className={styles.lede}>
          Moves exactly 1.000000 USDC from your public wallet into the Cloak pool. The wallet signs locally; this page never sees a seed phrase
          or private key. Nothing is sent until you confirm here and approve in your wallet.
        </p>

        <span className={`${styles.state} ${view.state === "SHIELDED" ? styles.ok : view.state === "FAILED" ? styles.err : ""}`}>
          <i /> {view.state}
        </span>

        {view.wallet && (
          <div className={styles.card}>
            <div className="kv"><span>{view.wallet.name}</span><span className="num" title={view.wallet.address}>{shortAddress(view.wallet.address)}</span></div>
            <div className="kv"><span>Public USDC</span><span className={`num ${styles.strong}`}>{view.publicUsdc === null ? "—" : formatUsdc6(view.publicUsdc)}</span></div>
            <div className="kv"><span>SOL for fees</span><span className="num">{view.solLamports === null ? "—" : formatSol9(view.solLamports)}</span></div>
            <div className="kv"><span>Private USDC (Cloak)</span><span className="num">{view.shieldedUsdc === null ? "locked" : formatUsdc6(view.shieldedUsdc)}</span></div>
          </div>
        )}

        {view.state === "WALLET_REQUIRED" && (
          <div className={styles.row}>
            <button className="btn light" disabled={!wallet} onClick={() => void op.connect(false)}>
              {wallet ? `Connect ${wallet.name}` : "Install Phantom to continue"}
            </button>
          </div>
        )}

        {view.state === "CLOAK_UNLOCK_REQUIRED" && (
          <>
            <p style={{ color: "var(--night-ink-2)" }}>Your wallet asks for one signature. It is not a transaction; it unlocks your private balance on this device.</p>
            <div className={styles.row}>
              <button className="btn light" onClick={() => void op.unlock()}>Unlock Cloak</button>
            </div>
          </>
        )}

        {view.state === "CLOAK_READY" && (
          <div className={styles.row}>
            <button className="btn light" onClick={() => void op.prepare()}>Prepare shield of 1 USDC</button>
          </div>
        )}

        {(view.state === "SHIELD_PREPARED" || view.state === "USER_CONFIRMATION_REQUIRED") && summary && (
          <>
            <h2 className="display" style={{ fontSize: 32 }}>Confirm this operation</h2>
            <div className={styles.card}>
              <div className="kv"><span>Network</span><span>Solana {summary.network}</span></div>
              <div className="kv"><span>Wallet</span><span className="num" title={summary.wallet}>{shortAddress(summary.wallet)}</span></div>
              <div className="kv"><span>Operation</span><span>{summary.operation}</span></div>
              <div className={`kv ${styles.strong}`}><span>Amount</span><span className="num">{summary.amountUsdc} USDC</span></div>
              <div className="kv"><span>SOL needed (estimate)</span><span className="num">≈ {summary.solRecommended} SOL</span></div>
              <div className="kv small"><span>· you have</span><span className="num">{summary.solBalance} SOL</span></div>
            </div>
            <p className={styles.fine}>
              Your wallet may ask twice: first for a one-time lookup-table transaction (rent only, no USDC moves), then for the 1 USDC deposit. The deposit
              is public on-chain; what happens after it is not linked to it. Nothing here retries automatically.
            </p>
            <div className={styles.row}>
              <button className="btn light" disabled={view.state !== "USER_CONFIRMATION_REQUIRED"} onClick={() => void op.confirm()}>
                Confirm and open wallet
              </button>
              <button className="btn ghost" style={ghost} disabled={view.state !== "USER_CONFIRMATION_REQUIRED"} onClick={() => op.cancel()}>Cancel</button>
            </div>
          </>
        )}

        {inFlight && (
          <>
            <h2 className="display" style={{ fontSize: 32 }}>{view.state === "WALLET_SIGNATURE_REQUIRED" ? "Approve in your wallet" : view.state === "SUBMITTING" ? "Sending" : "Confirming"}</h2>
            <p className={styles.status}>{view.stage}</p>
            <p className={styles.fine}>Keep this tab open. Do not press back or refresh; the button is locked so it cannot send twice.</p>
          </>
        )}

        {view.state === "SHIELDED" && proof && (
          <>
            <h2 className="display" style={{ fontSize: 32 }}>Shielded</h2>
            <p className={styles.okText}>{proof.amountUsdc} USDC is in your private balance.</p>
            <pre className={styles.proof}>{JSON.stringify(proof, null, 2)}</pre>
            <div className={styles.row}>
              <a className="btn light" href={`https://solscan.io/tx/${proof.signature}`} target="_blank" rel="noreferrer">View on Solscan</a>
              <button
                className="btn ghost"
                style={ghost}
                onClick={() => {
                  void navigator.clipboard.writeText(JSON.stringify(proof, null, 2)).then(() => setCopied(true));
                }}
              >
                {copied ? "Copied" : "Copy proof"}
              </button>
            </div>
            <p className={styles.fine}>
              <button className="tag" style={{ cursor: "pointer" }} onClick={() => void op.startAnother()}>Start another shield</button> — only if you really mean it.
            </p>
          </>
        )}

        {view.state === "FAILED" && failure && (
          <>
            <p className={`${styles.status} ${styles.err}`}>{failure.message}</p>
            <div className={styles.row}>
              {failure.blocking ? (
                <button className="btn light" onClick={() => void op.checkPending()}>Check on chain</button>
              ) : (
                <button className="btn light" onClick={() => void op.reset()}>Check again</button>
              )}
            </div>
            {failure.blocking && <p className={styles.fine}>A new shield is refused until this is resolved, so a second one can never be sent by accident.</p>}
            <ShieldDiagnostics session={session} {...(failure.diagnostic ? { diagnostic: failure.diagnostic } : {})} />
          </>
        )}

        {view.notice && <p className={styles.status}>{view.notice}</p>}
        {view.stage && !inFlight && view.state !== "USER_CONFIRMATION_REQUIRED" && <p className={styles.status}>{view.stage}</p>}

        <ol className={styles.steps}>
          {ORDER.map((s, i) => (
            <li key={s} className={i < reached || view.state === "SHIELDED" ? styles.stepDone : s === view.state ? styles.stepNow : ""}>{s}</li>
          ))}
        </ol>

        {rpcInfo?.viaProxy ? (
          <p className={styles.fine}>
            Network access: {rpcInfo.label}, forwarded to RPC Fast by the server. No endpoint or API key is ever sent to this browser. Your wallet signs
            locally and only the signed transaction is broadcast.
          </p>
        ) : (
          rpcInfo && (
            <details className={styles.details} open>
              <summary>Local development · RPC endpoint · {rpcInfo.label}</summary>
              <p>
                The Cloak SDK refuses an RPC served by this machine, so the same-origin proxy only works on the deployed site. For local testing,
                paste an https RPC endpoint; it stays in this browser only and is never shown.{" "}
                {rpcInfo.label === PUBLIC_DEFAULT && <span className={styles.err}>The public endpoint is rate-limited and often refuses browser calls.</span>}
              </p>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://…"
                disabled={inFlight}
                value={rpc}
                onChange={(e) => setRpc(e.target.value)}
                onBlur={() => {
                  setRpcUrl(rpc);
                  setRpcInfo(shieldRpc());
                }}
              />
            </details>
          )
        )}

        <p className={styles.fine}>
          UPAY3FOOD never asks for your seed phrase or private key. <Link href="/wallet">Wallet</Link> · <Link href="/privacy">What stays private →</Link>
        </p>
      </div>
    </div>
  );
}
