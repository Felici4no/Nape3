"use client";

import { useState } from "react";
import { formatSol9, formatUsdc6, type ShieldSession, type ShieldSimulation } from "@nape3/pay";
import { diagnosticFromMessage, formatDiagnostic, type RpcFailureDiagnostic } from "@nape3/payments/cloak";
import styles from "./money.module.css";

/**
 * Failure investigation for /shield. Everything here is read-only or
 * simulate-only: no transaction is signed for broadcast, nothing is sent, and
 * the blocking shield record is never cleared from here.
 */

type Diagnosis = Awaited<ReturnType<ShieldSession["diagnose"]>>;

function Block({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className={styles.details} open>
      <summary>{title}</summary>
      <pre className={styles.pre}>{text}</pre>
      <button
        className="tag"
        style={{ cursor: "pointer" }}
        onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </details>
  );
}

function diagnosisText(d: Diagnosis): string {
  const t = d.lookupTable;
  return [
    `Wallet: ${d.wallet}`,
    `Current slot (confirmed): ${d.currentSlot}`,
    `Public USDC: ${formatUsdc6(d.publicUsdc)}`,
    `SOL: ${formatSol9(d.solLamports)}`,
    `Private (Cloak) USDC: ${d.privateUsdc === null ? "unknown (unlock Cloak to read)" : formatUsdc6(d.privateUsdc)}`,
    `Cloak program transactions (a shield would be one): ${d.cloakTransactions.length ? d.cloakTransactions.join(", ") : "none"}`,
    `Lookup-table transaction: ${d.lookupTableTransaction ? `${d.lookupTableTransaction.signature} (slot ${d.lookupTableTransaction.slot}, ${d.lookupTableTransaction.failed ? "failed" : "succeeded"}, ${d.lookupTableTransaction.lookupTable?.actions.join(" + ")})` : "none found"}`,
    ...(t
      ? [
          `Lookup table ${t.address}: ${t.exists ? "exists" : "MISSING"}, owner ${t.owner ?? "-"}, ${t.active ? "active" : `deactivation slot ${t.deactivationSlot}`}`,
          `  authority ${t.authority ?? "-"}, ${t.addresses.length} addresses, last extended at slot ${t.lastExtendedSlot} (start index ${t.lastExtendedSlotStartIndex}); warmed up now: ${t.warmedUp}`,
          ...t.addresses.map((a, i) => `  [${i}] ${a}`)
        ]
      : []),
    "Latest signatures:",
    ...d.signatures.map((s) => `  ${s.slot} ${s.failed ? "FAILED" : "ok"} ${s.kind.padEnd(12)} ${s.signature}`)
  ].join("\n");
}

function simulationText(s: ShieldSimulation): string {
  const lines = [`Lookup tables used: ${s.lookupTables.join(", ") || "none (SDK would create one: simulated only)"}`];
  if (s.stoppedBy) lines.push(`SDK stopped before any transaction was built: ${s.stoppedBy}`);
  s.attempts.forEach((a, i) => lines.push("", `Simulated transaction ${i + 1}/${s.attempts.length}: ${a.ok ? "WOULD SUCCEED" : "WOULD FAIL"}`, formatDiagnostic(a.diagnostic)));
  return lines.join("\n");
}

export function ShieldDiagnostics({ session, diagnostic }: { session: ShieldSession; diagnostic?: RpcFailureDiagnostic }) {
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [simulation, setSimulation] = useState<ShieldSimulation | null>(null);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decoded = pasted.trim() ? diagnosticFromMessage(pasted) : null;

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={styles.diag}>
      <span className="eyebrow">Investigate (read-only)</span>
      <p className={styles.fine}>
        Run this before “Check on chain”: that button clears this attempt’s record when your public USDC is unchanged. Nothing below signs for broadcast or
        sends a transaction.
      </p>
      {diagnostic && <Block title="RPC failure captured during the shield" text={formatDiagnostic(diagnostic)} />}

      <div className={styles.row}>
        <button className="btn light" disabled={busy !== null} onClick={() => void run("diagnose", async () => setDiagnosis(await session.diagnose()))}>
          {busy === "diagnose" ? "Reading chain…" : "Read on-chain state"}
        </button>
        <button
          className="btn ghost"
          style={{ color: "var(--night-ink)", boxShadow: "inset 0 0 0 1.5px var(--night-ink)" }}
          disabled={busy !== null || !diagnosis?.lookupTable?.exists}
          title={diagnosis?.lookupTable?.exists ? "" : "Read on-chain state first: the simulation reuses the existing lookup table"}
          onClick={() => void run("simulate", async () => setSimulation(await session.simulate([diagnosis!.lookupTable!.address])))}
        >
          {busy === "simulate" ? "Simulating (no broadcast)…" : "Simulate shield (no transaction)"}
        </button>
      </div>
      {error && <p className={`${styles.status} ${styles.err}`}>{error}</p>}
      {diagnosis && <Block title="On-chain state" text={diagnosisText(diagnosis)} />}
      {simulation && <Block title="Simulation (not broadcast)" text={simulationText(simulation)} />}

      <details className={styles.details}>
        <summary>Decode a console error</summary>
        <p className={styles.fine}>Paste the full “Solana error #-32002; Decode this error by running …” line from the browser console. It is decoded here, locally.</p>
        <textarea className={styles.paste} rows={3} value={pasted} onChange={(e) => setPasted(e.target.value)} spellCheck={false} />
        {pasted.trim() && <pre className={styles.pre}>{decoded ? formatDiagnostic(decoded) : "No encoded Solana error context found in this text."}</pre>}
      </details>
    </section>
  );
}
