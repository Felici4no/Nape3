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
      if (!r.found || !r.payload) return setChecks((c) => ({ ...c, [signature]: { state: "missing", detail: r.found ? "transação sem memo UPAY3FOOD" : "transação não encontrada" } }));
      const same = r.payload.methodologySha256 === current.methodologySha256 && r.payload.engineSha256 === current.engineSha256;
      setChecks((c) => ({ ...c, [signature]: { state: same ? "match" : "older", detail: `slot ${r.slot}${r.blockTime ? ` · ${new Date(r.blockTime * 1000).toLocaleString("pt-BR")}` : ""}` } }));
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
    idle: "Verificar",
    checking: "Verificando…",
    match: "✓ Corresponde a esta versão",
    older: "✓ Registro válido de uma versão anterior",
    missing: "Não encontrado",
    error: "Erro ao verificar"
  };

  return (
    <div className={styles.panel}>
      {anchors.length === 0 ? (
        <p className="muted">Nenhum registro ainda.</p>
      ) : (
        <ul className={styles.anchors}>
          {anchors.map((a) => {
            const check = checks[a.signature] ?? { state: "idle" };
            return (
              <li key={a.signature}>
                <div>
                  <a href={solscan(a.signature)} target="_blank" rel="noreferrer" className="num">{short(a.signature)}</a>
                  <span className="muted small"> · {new Date(a.anchoredAt).toLocaleDateString("pt-BR")} · commit {a.commit ?? "—"} · slot {a.slot ?? "—"}</span>
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
        <strong>Registrar esta versão</strong>
        <p className="muted small">Uma transação SPL Memo, assinada pela sua carteira (Phantom) e enviada pelo RPC do site. Não move fundos; custa só a taxa da rede (~0,000005 SOL).</p>
        <pre className={styles.memo}><code>{anchorMemo(current)}</code></pre>
        {!confirming ? (
          <button className="btn" disabled={busy} onClick={() => setConfirming(true)}>Registrar na Solana mainnet</button>
        ) : (
          <div className={styles.confirm}>
            <span>Confirma? A carteira vai pedir a assinatura desta transação real.</span>
            <button className="btn" disabled={busy} onClick={() => void anchor()}>{busy ? "Assinando e enviando…" : "Sim, registrar"}</button>
            <button className="btn ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancelar</button>
          </div>
        )}
        {result && (
          <p className={styles.ok}>
            Registrado: <a href={solscan(result.signature)} target="_blank" rel="noreferrer" className="num">{short(result.signature)}</a> · slot {result.slot ?? "—"}. Envie a assinatura para incluí-la na lista pública.
          </p>
        )}
        {error && <p className="warn small">{error}</p>}
      </div>
    </div>
  );
}
