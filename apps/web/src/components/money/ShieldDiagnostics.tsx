"use client";

import { useState } from "react";
import { altCleanupPlan, CLOAK_PROGRAM_ID, formatSol9, formatUsdc6, type ShieldSession, type ShieldSimulation } from "@nape3/pay";
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

function tableLines(t: Diagnosis["lookupTables"][number]): string[] {
  return [
    `Lookup table ${t.address}: ${t.exists ? "exists" : "MISSING"}, owner ${t.owner ?? "-"}, ${t.active ? "active" : `deactivation slot ${t.deactivationSlot}`}`,
    `  authority ${t.authority ?? "-"}, ${t.addresses.length} addresses, last extended at slot ${t.lastExtendedSlot} (start index ${t.lastExtendedSlotStartIndex}); warmed up now: ${t.warmedUp}`,
    ...t.addresses.map((a, i) => `  [${i}] ${a}`)
  ];
}

function diagnosisText(d: Diagnosis): string {
  return [
    `Wallet: ${d.wallet}`,
    `Current slot (confirmed): ${d.currentSlot}`,
    `Public USDC: ${formatUsdc6(d.publicUsdc)}`,
    `SOL: ${formatSol9(d.solLamports)}`,
    `Private (Cloak) USDC: ${d.privateUsdc === null ? "unknown (unlock Cloak to read)" : formatUsdc6(d.privateUsdc)}`,
    `Cloak program transactions (a shield would be one): ${d.cloakTransactions.length ? d.cloakTransactions.join(", ") : "none"}`,
    `Lookup tables found in recent transactions: ${d.lookupTables.length}`,
    ...d.lookupTables.flatMap(tableLines),
    "Rent reclaim plan for this wallet's lookup tables (nothing is sent from here):",
    ...altCleanupPlan(d.lookupTables, d.wallet, d.currentSlot).map(
      (c) => `  ${c.table}: ${c.recoverableLamports === null ? "?" : `${formatSol9(c.recoverableLamports)} SOL`} recoverable; next: ${c.next}. ${c.detail}`
    ),
    "Latest signatures:",
    ...d.signatures.map(
      (s) => `  ${s.slot} ${s.failed ? "FAILED" : "ok"} ${s.kind.padEnd(12)} ${s.signature}${s.lookupTable ? ` (${s.lookupTable.actions.join(" + ")} ${s.lookupTable.address})` : ""}`
    )
  ].join("\n");
}

const VERDICT_LABEL: Record<ShieldSimulation["verdict"], string> = {
  WOULD_SUCCEED: "SHIELD WOULD SUCCEED (Cloak deposit simulated)",
  WOULD_FAIL: "SHIELD WOULD FAIL (Cloak deposit simulated)",
  RPC_REJECTED: "RPC_REJECTED: the RPC refused to simulate the Cloak deposit (the program did not run)",
  NOT_A_SHIELD_SIMULATION: "NOT_A_SHIELD_SIMULATION: the Cloak deposit was not simulated"
};

function simulationText(s: ShieldSimulation): string {
  const lines = [`Verdict: ${VERDICT_LABEL[s.verdict]}`, `Requested message version: ${s.transactionVersion === 1 ? "Transaction V1 (no lookup tables)" : "v0 + lookup tables"}`];
  if (s.verdictReason) lines.push(`Reason: ${s.verdictReason}`);
  lines.push(`Lookup tables given to the SDK: ${s.lookupTables.join(", ") || "none"}`);
  if (s.stoppedBy) lines.push(`SDK stopped before any transaction was built: ${s.stoppedBy}`);
  if (s.stages.length) lines.push("SDK progress:", ...s.stages.map((st) => `  ${st}`));
  s.attempts.forEach((a, i) => {
    const t = a.transaction;
    const isShield = !!t?.programIds.includes(CLOAK_PROGRAM_ID);
    lines.push(
      "",
      `Simulated transaction ${i + 1}/${s.attempts.length}: ${isShield ? "Cloak deposit" : t?.altInstructions.length ? `lookup-table setup (${t.altInstructions.join(" + ")})` : "not a Cloak deposit"}: ${a.ok ? "simulation ok" : "simulation failed"}`
    );
    if (t) {
      lines.push(
        `  version ${t.version}, ${t.size} bytes serialized, ${t.staticKeys.length} static accounts, ${t.instructions.length} instructions:`,
        ...t.instructions.map((ix) => `    #${ix.index} ${ix.programId} (${ix.accounts} accounts, ${ix.dataLength} data bytes)`)
      );
      if (t.config) lines.push(`  v1 compute config: ${JSON.stringify(t.config)}`);
      if (t.lookupTables.length) lines.push(`  lookup tables referenced: ${t.lookupTables.map((l) => `${l.table} (w${l.writable}/r${l.readonly})`).join(", ")}`);
      if (t.extendedAddresses.length) lines.push(`  addresses this ALT would add (${t.extendedAddresses.length}):`, ...t.extendedAddresses.map((x) => `    ${x}`));
    }
    lines.push(formatDiagnostic(a.diagnostic));
  });
  return lines.join("\n");
}

export function ShieldDiagnostics({ session, diagnostic }: { session: ShieldSession; diagnostic?: RpcFailureDiagnostic }) {
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [simulation, setSimulation] = useState<ShieldSimulation | null>(null);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decoded = pasted.trim() ? diagnosticFromMessage(pasted) : null;
  /** Every existing, active table of this wallet: the deposit may need more than the most recent one. */
  const activeTables = (diagnosis?.lookupTables ?? []).filter((t) => t.exists && t.active).map((t) => t.address);

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
          disabled={busy !== null || !activeTables.length}
          title={activeTables.length ? "" : "Read on-chain state first: the simulation reuses the existing lookup tables"}
          onClick={() => void run("simulate", async () => setSimulation(await session.simulate(activeTables)))}
        >
          {busy === "simulate" ? "Simulating (no broadcast)…" : "Simulate shield (no transaction)"}
        </button>
        <button
          className="btn ghost"
          style={{ color: "var(--night-ink)", boxShadow: "inset 0 0 0 1.5px var(--night-ink)" }}
          disabled={busy !== null || !activeTables.length}
          title="Same deposit as a Transaction V1 message: every account static, no lookup tables, 4,096-byte packet. Simulated only."
          onClick={() => void run("simulate-v1", async () => setSimulation(await session.simulate(activeTables, { transactionVersion: 1 })))}
        >
          {busy === "simulate-v1" ? "Simulating V1 (no broadcast)…" : "Simulate as Transaction V1"}
        </button>
      </div>
      {error && <p className={`${styles.status} ${styles.err}`}>{error}</p>}
      {diagnosis && <Block title="On-chain state" text={diagnosisText(diagnosis)} />}
      {simulation && (
        <p className={`${styles.status} ${simulation.verdict === "WOULD_SUCCEED" ? "" : styles.err}`}>{VERDICT_LABEL[simulation.verdict]}</p>
      )}
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
