"use client";

import "@nape3/pay/polyfills";
import { useEffect, useMemo, useState } from "react";
import type { AgentState } from "@nape3/agent";
import { formatBRL } from "@nape3/domain";
import { formatUsdcDisplay as usdc } from "@nape3/payments";
import { PRIVACY_COPY } from "@nape3/payments/privacy-copy";
import {
  connectedToExtension,
  createPaymentFlow,
  findWallet,
  getRpcUrl,
  loadPaymentRequest,
  reportDisconnected,
  setRpcUrl,
  type FlowView,
  type PaymentFlow,
  type PaymentRequest
} from "@nape3/pay";
import { shortAddress } from "@/lib/format";
import styles from "./money.module.css";

const STEPS: Array<{ title: string; states: AgentState[] }> = [
  { title: "Wallet", states: ["PAYMENT_TARGET_DETECTED", "WALLET_REQUIRED", "WALLET_CONNECTED"] },
  { title: "Private funds", states: ["FUNDS_CHECKED", "SHIELD_REQUIRED"] },
  { title: "Confirm", states: ["PAYMENT_READY", "PAYMENT_AUTHORIZED", "SETTLED"] }
];

const DESTINATION = {
  "pix-payload-via-offramp": "Pix Copia e Cola, paid by a USDC→BRL off-ramp",
  "pix-selected-via-offramp": "Pix, paid by a USDC→BRL off-ramp"
} as const;

const ghost = { color: "var(--night-ink)", boxShadow: "inset 0 0 0 1.5px var(--night-ink)" };

function Step({ flow, view }: { flow: PaymentFlow; view: FlowView }) {
  const { agent } = view;
  const busy = view.busy !== null;
  const wallet = findWallet();
  switch (agent.state) {
    case "PAYMENT_TARGET_DETECTED":
    case "WALLET_REQUIRED":
      return (
        <>
          <h2 className="display" style={{ fontSize: 36 }}>Connect your wallet</h2>
          <p style={{ color: "var(--night-ink-2)" }}>Pay with USDC from your Solana wallet, funded through Cloak's shielded pool.</p>
          <button className="btn light block" disabled={busy || !wallet} onClick={() => void flow.connect()}>
            {wallet ? `Connect ${wallet.name}` : "Install Phantom or Solflare to continue"}
          </button>
          <p className={styles.fine}>UPAY3FOOD never asks for your seed phrase or private key.</p>
        </>
      );
    case "WALLET_CONNECTED":
    case "FUNDS_CHECKED":
      return (
        <>
          <h2 className="display" style={{ fontSize: 36 }}>Check your private balance</h2>
          <p style={{ color: "var(--night-ink-2)" }}>Your wallet asks for one signature. It is not a transaction; it unlocks your shielded balance on this device.</p>
          <button className="btn light block" disabled={busy} onClick={() => void flow.checkFunds()}>Check balances</button>
        </>
      );
    case "SHIELD_REQUIRED": {
      const a = agent.fundingAssessment;
      const f = agent.funds;
      if (a?.kind !== "shield-required" || !f) return null;
      return (
        <>
          <h2 className="display" style={{ fontSize: 36 }}>Move funds into your private balance</h2>
          <div className={styles.card}>
            <div className="kv"><span>Public USDC</span><span className="num">{usdc(f.publicUsdc)}</span></div>
            <div className="kv"><span>Private USDC (Cloak)</span><span className="num">{usdc(f.shieldedUsdc)}</span></div>
            <div className={`kv ${styles.strong}`}><span>Needed for this order</span><span className="num">{usdc(agent.fundingRequirement!.grossUsdc)}</span></div>
          </div>
          {a.canShield ? (
            <>
              <button className="btn light block" disabled={busy} onClick={() => void flow.shieldRequired()}>
                Shield required amount ({usdc(a.shieldAmountUsdc)})
              </button>
              <p className={styles.fine}>{PRIVACY_COPY.tip}</p>
            </>
          ) : (
            <>
              <p className={styles.err}>
                {a.reason === "insufficient-public-usdc"
                  ? `Not enough USDC. Add at least ${usdc(a.addPublicUsdc)} to this wallet.`
                  : "Add about 0.01 SOL to this wallet for network fees."}
              </p>
              <button className="btn ghost" style={ghost} disabled={busy} onClick={() => void flow.checkFunds()}>Check again</button>
            </>
          )}
        </>
      );
    }
    case "PAYMENT_READY": {
      const r = agent.fundingRequirement!;
      return (
        <>
          <h2 className="display" style={{ fontSize: 36 }}>Confirm payment</h2>
          <div className={styles.card}>
            <div className={`kv ${styles.strong}`}><span>Checkout total</span><span className="num">{formatBRL(r.checkoutTotalCents)}</span></div>
            <div className="kv"><span>Funding (estimated)</span><span className="num">{usdc(r.grossUsdc)}</span></div>
            <div className="kv small"><span>· Cloak privacy fee</span><span className="num">{usdc(r.cloakFeeUsdc)}</span></div>
            <div className="kv small"><span>· Off-ramp receives</span><span className="num">{usdc(r.offrampNetUsdc)}</span></div>
            <div className="kv"><span>From</span><span>Your private balance (Cloak)</span></div>
            <div className="kv"><span>Destination</span><span>{DESTINATION[r.destination]}</span></div>
          </div>
          {r.quoteSimulated && <p className={styles.fine} style={{ color: "#f6d77a" }}>USDC amounts use a simulated off-ramp quote: no licensed provider is integrated yet.</p>}
          <div className={styles.row}>
            <button className="btn light" disabled={busy} onClick={() => void flow.confirm()}>Confirm {formatBRL(r.checkoutTotalCents)}</button>
            <button className="btn ghost" style={ghost} disabled={busy} onClick={() => flow.reject()}>Cancel</button>
          </div>
        </>
      );
    }
    case "PAYMENT_AUTHORIZED":
    case "SETTLED":
      return (
        <>
          <h2 className="display" style={{ fontSize: 36 }}>{view.settlement?.settled ? "Paid" : "Authorized, not settled"}</h2>
          <p className={view.settlement?.settled ? styles.okText : ""} style={{ color: view.settlement?.settled ? undefined : "#f6d77a" }}>{view.settlement?.text}</p>
        </>
      );
    case "IDLE":
      return (
        <>
          <h2 className="display" style={{ fontSize: 36 }}>Payment cancelled</h2>
          <p>Nothing was charged.</p>
        </>
      );
    default:
      return <p className={styles.err}>Unexpected state {agent.state}</p>;
  }
}

export default function PayScreen() {
  const [request, setRequest] = useState<PaymentRequest | null | undefined>(undefined);
  const flow = useMemo(() => (request ? createPaymentFlow(request) : null), [request]);
  const [view, setView] = useState<FlowView | null>(null);
  const [rpc, setRpc] = useState("");

  useEffect(() => {
    setRpc(getRpcUrl());
    void loadPaymentRequest().then(setRequest);
  }, []);

  useEffect(() => {
    if (!flow) return;
    const unsubscribe = flow.subscribe(setView);
    void flow.start();
    return unsubscribe;
  }, [flow]);

  if (request === undefined) return <div className={`wrap ${styles.page}`}><div className={`night ${styles.sheet}`}>Loading checkout…</div></div>;
  if (request === null || !flow || !view) {
    return (
      <div className={`wrap ${styles.page}`}>
        <div className={`night ${styles.sheet}`}>
          <span className={`eyebrow ${styles.eyebrow}`}>UPAY3FOOD Pay</span>
          <h1 className={`display ${styles.h1}`}>No checkout to pay.</h1>
          <p className={styles.lede}>
            Open UPAY3FOOD.agent on an iFood checkout with Pix and choose “Pay with crypto”, or use Execute on a market page with your
            checkout total.
          </p>
        </div>
      </div>
    );
  }

  const current = STEPS.findIndex((s) => s.states.includes(view.agent.state));
  return (
    <div className={`wrap ${styles.page}`}>
      <div className={`night ${styles.sheet}`}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span className={`eyebrow ${styles.eyebrow}`}>UPAY3FOOD Pay</span>
          {view.wallet && (
            <button className="tag" style={{ cursor: "pointer" }} onClick={() => { flow.disconnect(); reportDisconnected(); }}>
              {view.wallet.name} · {shortAddress(view.wallet.address)} · disconnect
            </button>
          )}
        </div>
        <div className={styles.order}>
          <span style={{ color: "var(--night-ink-2)" }}>
            {request.merchant ?? "Checkout"} · {request.destination === "pix-payload-via-offramp" ? "Pix detected" : "Pix"}
          </span>
          <span className={styles.total}>{formatBRL(request.amountCents)}</span>
          <span className={styles.privacy}>🛡 {PRIVACY_COPY.headline}</span>
        </div>

        <ol className={styles.stepper}>
          {STEPS.map((s, i) => (
            <li key={s.title} className={i < current ? styles.done : i === current ? styles.current : ""}>
              {i < current ? "✓" : i + 1} {s.title}
            </li>
          ))}
        </ol>

        <Step flow={flow} view={view} />

        {view.busy && <p className={styles.status}>{view.busy}</p>}
        {view.notice && (
          <p className={`${styles.status} ${view.notice.kind === "error" ? styles.err : view.notice.kind === "success" ? styles.okText : ""}`}>
            {view.notice.text}
            {view.notice.kind === "success" && view.notice.link && <> · <a href={view.notice.link} target="_blank" rel="noreferrer">view transaction</a></>}
          </p>
        )}

        <details className={styles.details}>
          <summary>What stays private?</summary>
          <p>{PRIVACY_COPY.whatIsHidden}</p>
          <p>{PRIVACY_COPY.whatIsNotHidden}</p>
        </details>
        <details className={styles.details}>
          <summary>Advanced</summary>
          <label>
            Solana RPC
            <input value={rpc} onChange={(e) => setRpc(e.target.value)} onBlur={() => setRpcUrl(rpc)} />
          </label>
          <p>{connectedToExtension() ? "Linked to UPAY3FOOD.agent" : "Not opened from the extension"} · state {view.agent.state}</p>
        </details>
      </div>
    </div>
  );
}
