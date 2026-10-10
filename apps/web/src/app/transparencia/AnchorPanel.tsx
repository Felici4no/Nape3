"use client";

import "@nape3/pay/polyfills";
import { useState } from "react";
import { anchorMemo, anchorOnSolana, readAnchor, type AnchorPayload } from "@nape3/pay";
import type { Anchor } from "./page";
import styles from "./transparencia.module.css";

const short = (s: string) => `${s.slice(0, 8)}…${s.slice(-8)}`;
const solscan = (sig: string) => `https://solscan.io/tx/${sig}`;

type Check = { state: "idle" | "checking" | "match" | "older" | "missing" | "error"; detail?: string };

export function AnchorPanel({ current, anchors }: { current: AnchorPayload; anchors: Anchor[] }) {
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ signature: string; slot: number | null; signer: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function verify(signature: string) {
    setChecks((c) => ({ ...c, [signature]: { state: "checking" } }));
    try {
      const r = await readAnchor(signature);
      if (!r.found || !r.payload) return setChecks((c) => ({ ...c, [signature]: { state: "missing", detail: r.found ? "transaction has no UPAY3FOOD memo" : "transaction not found" } }));
      const same = r.payload.methodologySha256 === current.methodologySha256 && r.payload.engineSha256 === current.engineSha256;
      setChecks((c) => ({ ...c, [signature]: { state: same ? "match" : "older", detail: `slot ${r.slot}${r.blockTime ? ` · ${new Date(r.blockTime * 1000).toLocaleString("en-GB")}` : ""}` } }));
    } catch (e) {
      setChecks((c) => ({ ...c, [signature]: { state: "error", detail: e instanceof Error ? e.message : String(e) } }));
    }
  }

  async function anchor() {
    setBusy(true);
    setError(null);
    try {
      const r = await anchorOnSolana(current);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const label: Record<Check["state"], string> = {
    idle: "Verify",
    checking: "Checking…",
    match: "✓ Matches this version",
    older: "✓ Valid record of an earlier version",
    missing: "Not found",
    error: "Could not verify"
  };

  return (
    <div className={styles.panel}>
      {anchors.length === 0 ? (
        <p className="muted">No records yet.</p>
      ) : (
        <ul className={styles.anchors}>
          {anchors.map((a) => {
            const check = checks[a.signature] ?? { state: "idle" };
            return (
              <li key={a.signature}>
                <div>
                  <a href={solscan(a.signature)} target="_blank" rel="noreferrer" className="num">{short(a.signature)}</a>
                  <span className="muted small"> · {new Date(a.anchoredAt).toLocaleDateString("en-GB")} · commit {a.commit ?? "—"} · slot {a.slot ?? "—"}</span>
                </div>
                <button className={`btn ghost ${styles.verify}`} disabled={check.state === "checking"} onClick={() => void verify(a.signature)}>
                  {label[check.state]}
                </button>
                {check.detail && <span className="muted small">{check.detail}</span>}
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.new}>
        <strong>Anchor this version</strong>
        <p className="muted small">One SPL Memo transaction, signed by your wallet (Phantom) and sent through the site’s RPC. It moves no funds; it only costs the network fee (~0.000005 SOL).</p>
        <pre className={styles.memo}><code>{anchorMemo(current)}</code></pre>
        {!confirming ? (
          <button className="btn" disabled={busy} onClick={() => setConfirming(true)}>Anchor on Solana mainnet</button>
        ) : (
          <div className={styles.confirm}>
            <span>Confirm? Your wallet will ask you to sign this real transaction.</span>
            <button className="btn" disabled={busy} onClick={() => void anchor()}>{busy ? "Signing and sending…" : "Yes, anchor it"}</button>
            <button className="btn ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        )}
        {result && (
          <p className={styles.ok}>
            Anchored: <a href={solscan(result.signature)} target="_blank" rel="noreferrer" className="num">{short(result.signature)}</a> · slot {result.slot ?? "—"}. Send us the signature to add it to the public list.
          </p>
        )}
        {error && <p className="warn small">{error}</p>}
      </div>
    </div>
  );
}
