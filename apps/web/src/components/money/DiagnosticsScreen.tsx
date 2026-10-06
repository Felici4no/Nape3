"use client";

import "@nape3/pay/polyfills";
import { useEffect, useState } from "react";
import { clearRpcTrace, onRpcTrace, rpcTrace, systemDiagnostics, type RpcTraceEntry, type SystemDiagnostics } from "@nape3/pay";
import styles from "./money.module.css";

/**
 * /diagnostics: which layer of the money path works, read-only. Nothing here
 * signs, sends a transaction, shields or asks the wallet (silent reconnect only).
 */
function Row({ name, status, detail }: { name: string; status: string; detail: string }) {
  const tone = status === "OK" || status === "YES" ? styles.okText : status === "SKIPPED" ? "" : styles.err;
  return (
    <div className="kv">
      <span>{name}</span>
      <span>
        <strong className={tone}>{status}</strong> <span className="small muted">{detail}</span>
      </span>
    </div>
  );
}

export default function DiagnosticsScreen() {
  const [diag, setDiag] = useState<SystemDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [trace, setTrace] = useState<readonly RpcTraceEntry[]>(rpcTrace());

  useEffect(() => onRpcTrace((entries) => setTrace([...entries])), []);

  async function run() {
    setBusy(true);
    try {
      setDiag(await systemDiagnostics());
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void run();
  }, []);

  return (
    <div className={`wrap ${styles.page}`}>
      <div className={`night ${styles.sheet}`}>
        <span className={`eyebrow ${styles.eyebrow}`}>Diagnostics · read-only · nothing is signed or sent</span>
        <h1 className={`display ${styles.h1}`}>Is the money path up?</h1>
        <div className={styles.row}>
          <button className="btn light" disabled={busy} onClick={() => void run()}>
            {busy ? "Checking…" : "Run checks again"}
          </button>
        </div>
        {diag && (
          <div className={styles.card}>
            <Row name="Solana proxy (server)" status={diag.proxy.status} detail={diag.proxy.detail} />
            <Row name="RPC upstream (RPC Fast)" status={diag.upstream.status} detail={diag.upstream.detail} />
            <Row name="Network" status={diag.network === "mainnet-beta" ? "OK" : diag.network.toUpperCase()} detail={diag.network} />
            <Row name="Browser → proxy (getSlot)" status={diag.browserRpc.status} detail={diag.browserRpc.detail} />
            <Row name="Wallet detected" status={diag.wallet.detected ? "YES" : "NO"} detail={diag.wallet.name ?? ""} />
            <Row name="Wallet address" status={diag.wallet.address ? "YES" : "—"} detail={diag.wallet.address ?? "not connected to this site yet (no prompt here)"} />
            <Row name="Cloak SDK / relay" status={diag.cloak.status} detail={diag.cloak.detail} />
            <p className="small muted">Checked {new Date(diag.checkedAt).toLocaleTimeString()}</p>
          </div>
        )}

        <details className={styles.details} open>
          <summary>RPC requests from this page ({trace.length})</summary>
          <p className="small muted">
            Method, HTTP status, JSON-RPC error code, time and the layer that failed. Never the endpoint URL, parameters or signed transactions.
          </p>
          <pre className={styles.pre}>
            {trace.length === 0
              ? "No requests yet."
              : trace
                  .map(
                    (t) =>
                      `${t.timestamp.slice(11, 23)} ${t.stage.padEnd(16)} ${t.endpoint.padEnd(15)} ${t.method.padEnd(24)} HTTP ${t.httpStatus ?? "—"}${t.rpcErrorCode !== null ? ` rpc ${t.rpcErrorCode}` : ""} ${t.durationMs}ms${t.classification ? `  ${t.classification}` : ""}`
                  )
                  .join("\n")}
          </pre>
          <button className="tag" style={{ cursor: "pointer" }} onClick={() => clearRpcTrace()}>
            Clear
          </button>
        </details>
      </div>
    </div>
  );
}
