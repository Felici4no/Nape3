"use client";

import { useState } from "react";
import {
  altCleanupPlan,
  CLOAK_PROGRAM_ID,
  formatSol9,
  formatUsdc6,
  type RelayPathRun,
  type ShieldCost,
  type ShieldSession,
  type ShieldSimulation,
  type V1SigningResult
} from "@nape3/pay";
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

const sol = (l: bigint | null) => (l === null ? "unknown" : `${formatSol9(l)} SOL (${l.toString()} lamports)`);

function costText(c: ShieldCost): string {
  const created = c.movements.filter((m) => m.kind === "createAccount");
  return [
    "SOL requirement (measured from this simulation; nothing was sent):",
    `  Fee payer: ${c.feePayer}`,
    `  Network fee for this exact message (getFeeForMessage): ${sol(c.networkFee)}`,
    `    base (signature) fee: ${sol(c.baseFee)}`,
    `    priority fee (from the transaction's compute config): ${sol(c.priorityFee)}`,
    ...(c.networkFee === null ? ["    (the RPC returned no fee for this message; the total assumes 2 signatures × 5,000 lamports + the priority fee)"] : []),
    `  System Program movements during execution (${c.movements.length}; ${created.length} account creations):`,
    ...c.movements.map(
      (m) =>
        `    ${m.kind} ${m.from === c.feePayer ? "wallet" : m.from} → ${m.to}: ${sol(m.lamports)}${m.space !== undefined ? `, ${m.space} bytes, owner ${m.owner}` : ""}; ${m.toExistedBefore ? "account already existed" : "NEW account"}`
    ),
    `  Rent into newly created accounts (paid by the wallet): ${sol(c.rentIntoNewAccounts)}`,
    `  Other wallet debits not explained by the fee or System movements: ${sol(c.otherDebits)}`,
    `  Simulated post-balance already had the fee deducted: ${c.simulationIncludesFee === null ? "could not tell" : c.simulationIncludesFee ? "yes" : "no"}`,
    `  ESTIMATED TOTAL SOL SPENT BY THE WALLET: ${sol(c.estimatedTotal)}`,
    `  Wallet must also keep its rent-exempt minimum: ${sol(c.payerRentExemptMinimum)}`,
    `  RECOMMENDED MINIMUM BALANCE (total + rent-exempt minimum + margin max(10%, 0.0005 SOL)): ${sol(c.recommendedMinimum)}`,
    `  Current wallet balance: ${sol(c.walletBalance)} → ${c.sufficient ? "SUFFICIENT" : "NOT SUFFICIENT"} (short by ${c.sufficient ? "0" : formatSol9(c.recommendedMinimum - c.walletBalance)} SOL)`,
    "  Writable accounts (balance now → simulated after):",
    ...c.accounts.map((a) => `    ${a.address}: ${a.before === null ? "does not exist" : a.before.toString()} → ${a.after === null ? "n/a" : a.after.toString()}`)
  ].join("\n");
}

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
      lines.push(`  writable accounts: ${t.writableKeys.length}; priority fee requested: ${t.priorityFeeLamports.toString()} lamports; compute unit limit: ${t.computeUnitLimit ?? "default"}`);
      if (t.lookupTables.length) lines.push(`  lookup tables referenced: ${t.lookupTables.map((l) => `${l.table} (w${l.writable}/r${l.readonly})`).join(", ")}`);
      if (t.extendedAddresses.length) lines.push(`  addresses this ALT would add (${t.extendedAddresses.length}):`, ...t.extendedAddresses.map((x) => `    ${x}`));
    }
    lines.push(formatDiagnostic(a.diagnostic));
    if (a.cost) lines.push(costText(a.cost));
    else if (a.costError) lines.push(`SOL requirement could not be measured: ${a.costError}`);
  });
  return lines.join("\n");
}

const V1_OUTCOME_LABEL: Record<V1SigningResult["phantomV1"], string> = {
  PHANTOM_V1_SIGNING_SUPPORTED: "PHANTOM_V1_SIGNING_SUPPORTED",
  PHANTOM_V1_SIGNING_UNSUPPORTED: "PHANTOM_V1_SIGNING_UNSUPPORTED",
  DIAGNOSTIC_REQUEST_INVALID: "DIAGNOSTIC_REQUEST_INVALID: our request may not match what the wallet expects; no conclusion about V1",
  INCONCLUSIVE_USER_REJECTED: "INCONCLUSIVE_USER_REJECTED: the request was rejected in the wallet"
};

function v1SigningText(r: V1SigningResult): string {
  const ws = r.walletStandard;
  return [
    `A. Phantom V1 support: ${r.phantomV1Support} (${r.phantomV1})`,
    `B. Current Cloak/web3.js adapter: ${r.cloakAdapter.works ? "YES" : "NO"}: ${r.cloakAdapter.reason}`,
    `Detail: ${r.detail}`,
    `Wallet: ${r.wallet}`,
    `Wallet Standard: ${ws.found ? `${ws.name}, solana:signTransaction supportedTransactionVersions = ${ws.signTransactionVersions ? JSON.stringify(ws.signTransactionVersions) : "not declared"}` : "no wallet with solana:signTransaction found"}`,
    ...r.attempts.flatMap((a, i) => [
      "",
      `Attempt ${i + 1}: ${a.path}: ${a.outcome}`,
      `  request: ${a.request}`,
      `  ${a.detail}`,
      ...(a.error ? [`  wallet error: ${a.error}`] : []),
      ...(a.responseShape ? [`  response shape (no values): ${a.responseShape}`] : []),
      `  message unchanged: ${a.checks.messageUnchanged ?? "-"}; still V1: ${a.checks.stillVersion1 ?? "-"}; signature valid for the message and the connected key: ${a.checks.signatureValid ?? "-"}`
    ]),
    "",
    `Broadcast attempts blocked by the guard: ${r.blockedBroadcasts}`,
    "Anything signed was verified locally, then wiped. Nothing was sent or stored."
  ].join("\n");
}

const RELAY_VERDICT_OK: ReadonlyArray<RelayPathRun["verdict"]> = ["READY_UP_TO_RELAY_ALT", "RELAY_ALT_DEPOSIT_WOULD_SUCCEED", "FITS_WITHOUT_RELAY_ALT"];

function relayRunText(r: RelayPathRun): string {
  const q = r.report.quote;
  const lines = [
    `Mode: ${r.mode === "dry-run" ? "dry run (no relay call, nothing sent)" : "relay test (relay table requested for real; deposit only simulated)"}`,
    `Verdict: ${r.verdict}`,
    `Reason: ${r.reason}`,
    `Guard: stage ${r.report.stage}; violation ${r.report.violation ?? "none"}; wallet signatures requested ${r.report.signatures}`,
    `Relay request: ${r.report.relayRequest ? `mint ${r.report.relayRequest.mint}, depositor ${r.report.relayRequest.depositor}, ${r.report.relayRequest.nullifiers} nullifiers, bind0 ${r.report.relayRequest.bind0Bytes} bytes` : "none"}`,
    `Relay table: ${r.report.relayTable ?? "-"}${r.report.relayFailed ? ` (relay: ${r.report.relayFailed})` : ""}`,
    `Lookup tables in the signed deposit: ${r.report.signedLookupTables.join(", ") || "-"}`,
    q
      ? `Risk quote: ${q.messageLength}-byte message (tag ${q.tag}); timestamp fields: ${q.timestampCandidates.map((c) => `@${c.offset} ${c.secondsFromFetch >= 0 ? "+" : ""}${c.secondsFromFetch}s`).join(", ") || "none found"}; expiry ${q.expiresAtMs === null ? "not found" : `${Math.round((q.expiresAtMs - q.fetchedAtMs) / 1000)}s after fetch`}`
      : "Risk quote: not observed",
    "Timeline (ms since start):",
    ...r.report.events.map((e) => `  +${e.atMs} ${e.kind}: ${e.detail}`)
  ];
  if (r.stoppedBy) lines.push(`Stopped by: ${r.stoppedBy}`);
  if (r.stages.length) lines.push("SDK progress:", ...r.stages.map((st) => `  ${st}`));
  r.attempts.forEach((a, i) => {
    const t = a.transaction;
    lines.push("", `Simulated transaction ${i + 1}/${r.attempts.length}: ${t?.programIds.includes(CLOAK_PROGRAM_ID) ? "Cloak deposit" : "not a Cloak deposit"}: ${a.ok ? "simulation ok" : "simulation failed"}`);
    if (t) {
      lines.push(`  version ${t.version}, ${t.size} bytes, ${t.staticKeys.length} static accounts; lookup tables: ${t.lookupTables.map((l) => `${l.table} (w${l.writable}/r${l.readonly})`).join(", ") || "none"}`);
    }
    lines.push(formatDiagnostic(a.diagnostic));
    if (a.cost) lines.push(costText(a.cost));
  });
  return lines.join("\n");
}

export function ShieldDiagnostics({ session, diagnostic }: { session: ShieldSession; diagnostic?: RpcFailureDiagnostic }) {
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const [simulation, setSimulation] = useState<ShieldSimulation | null>(null);
  const [v1Signing, setV1Signing] = useState<V1SigningResult | null>(null);
  const [relayRun, setRelayRun] = useState<RelayPathRun | null>(null);
  const [relayAck, setRelayAck] = useState(false);
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
      {simulation?.outcome?.cost && (
        <p className={`${styles.status} ${simulation.outcome.cost.sufficient ? "" : styles.err}`}>
          SOL needed: {formatSol9(simulation.outcome.cost.estimatedTotal)} spent, {formatSol9(simulation.outcome.cost.recommendedMinimum)} recommended minimum balance;
          wallet has {formatSol9(simulation.outcome.cost.walletBalance)}: {simulation.outcome.cost.sufficient ? "sufficient" : "not sufficient"}.
        </p>
      )}
      {simulation && <Block title="Simulation (not broadcast)" text={simulationText(simulation)} />}

      <div className={styles.diag}>
        <span className="eyebrow">Plan B · v0 + relay-paid lookup table</span>
        <p className={styles.fine}>
          The shield Phantom can sign: a v0 deposit whose extra lookup table is created and paid by the Cloak relay. Your wallet never signs or pays for a
          lookup table (that fallback is blocked), and approves exactly one transaction, the deposit.
        </p>
        <div className={styles.row}>
          <button className="btn ghost" style={{ color: "var(--night-ink)", boxShadow: "inset 0 0 0 1.5px var(--night-ink)" }} disabled={busy !== null} onClick={() => void run("relay-dry", async () => setRelayRun(await session.simulateRelayPath()))}>
            {busy === "relay-dry" ? "Dry run (no relay call)…" : "Dry-run plan B (no relay call, nothing sent)"}
          </button>
        </div>
        <p className={styles.fine}>
          <strong>First real relay lookup-table test.</strong> This asks the Cloak relay for the lookup table for real: the relay writes it on chain and pays
          for it. Then the deposit that uses it is only simulated. Your wallet signs no transaction, and nothing is sent from this page.
        </p>
        <label className={styles.fine} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input type="checkbox" checked={relayAck} onChange={(e) => setRelayAck(e.target.checked)} />I understand the relay will write a lookup table on chain at its cost, and that no shield is sent.
        </label>
        <div className={styles.row}>
          <button className="btn light" disabled={busy !== null || !relayAck} onClick={() => void run("relay-test", async () => {
            setRelayAck(false);
            setRelayRun(await session.testRelayAlt());
          })}>
            {busy === "relay-test" ? "Relay test running (deposit simulated only)…" : "Run the first real relay-ALT test"}
          </button>
        </div>
        {relayRun && <p className={`${styles.status} ${RELAY_VERDICT_OK.includes(relayRun.verdict) ? "" : styles.err}`}>{relayRun.verdict}: {relayRun.reason}</p>}
        {relayRun && <Block title={relayRun.mode === "dry-run" ? "Plan B dry run (nothing sent)" : "Relay lookup-table test (deposit simulated, nothing sent)"} text={relayRunText(relayRun)} />}
      </div>

      <div className={styles.diag}>
        <span className="eyebrow">Transaction V1 signing test</span>
        <p className={styles.fine}>
          This asks Phantom to sign a harmless Transaction V1.
          <br />
          It will not be broadcast and cannot move funds.
        </p>
        <p className={styles.fine}>
          The transaction is a 0-lamport transfer from your wallet to itself. Only “sign” is requested (never “sign and send”): first through Wallet
          Standard, then, only if that route does not give an answer, through Phantom’s request API, so you may see up to two sign requests. The
          signature is checked here and then discarded. While the test runs, any attempt to broadcast is blocked.
        </p>
        <div className={styles.row}>
          <button
            className="btn ghost"
            style={{ color: "var(--night-ink)", boxShadow: "inset 0 0 0 1.5px var(--night-ink)" }}
            disabled={busy !== null}
            onClick={() => void run("v1-signing", async () => setV1Signing(await session.testV1Signing()))}
          >
            {busy === "v1-signing" ? "Waiting for Phantom (sign only)…" : "Run Transaction V1 signing test"}
          </button>
        </div>
        {v1Signing && (
          <p className={`${styles.status} ${v1Signing.phantomV1 === "PHANTOM_V1_SIGNING_SUPPORTED" ? "" : styles.err}`}>
            Phantom V1 support: {v1Signing.phantomV1Support} · Current Cloak/web3.js adapter: {v1Signing.cloakAdapter.works ? "YES" : "NO"}
          </p>
        )}
        {v1Signing && <Block title="Transaction V1 signing test (nothing sent)" text={v1SigningText(v1Signing)} />}
      </div>

      <details className={styles.details}>
        <summary>Decode a console error</summary>
        <p className={styles.fine}>Paste the full “Solana error #-32002; Decode this error by running …” line from the browser console. It is decoded here, locally.</p>
        <textarea className={styles.paste} rows={3} value={pasted} onChange={(e) => setPasted(e.target.value)} spellCheck={false} />
        {pasted.trim() && <pre className={styles.pre}>{decoded ? formatDiagnostic(decoded) : "No encoded Solana error context found in this text."}</pre>}
      </details>
    </section>
  );
}
