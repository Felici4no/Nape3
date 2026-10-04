"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { base58Encode } from "@nape3/chain";
import { brl } from "@/lib/format";
import styles from "./RunPanel.module.css";

/**
 * A persistent agent run, live. The deterministic runtime (apps/agent-api)
 * owns execution; this panel shows its event stream and sends only the
 * inputs that belong to the user: wallet state, confirmation, cancellation.
 */

interface RunView {
  id: string;
  state: string;
  executionMode: "simulated" | "real";
  waitingOnUser?: string;
  payment: {
    walletAddress?: string;
    assessment?: { kind: string; canShield?: boolean; shieldAmountUsdc?: string };
    confirmationRequest?: { amountCents: number; grossUsdc: string; walletAddress: string; digest: string; expiresAt: string };
  };
  candidates: Array<{ candidateId: string; source: string }>;
  failure?: { reason: string };
}

interface Line {
  seq: number;
  at: string;
  message: string;
}

const TERMINAL = ["ORDER_CONFIRMED", "NO_VALID_OPTION", "CANCELLED", "SETTLEMENT_FAILED", "FAILED"];
/** Simulated demo wallet: sha256("upay3food:simulated-demo-wallet") as an address; nobody holds its key. */
const DEMO_WALLET = "DfbzyPgnAWN3URpMqA7xhFKZamu2Kq79AnZkBiRd4pYg";
/** Before PAYMENT_SUBMITTED the user can still cancel; after it, money is in flight. */
const CANCELLABLE = ["INTENT_CAPTURED", "MARKET_SEARCH", "CANDIDATES_NORMALIZED", "BEST_OPTION_SELECTED", "REVALIDATION_REQUESTED", "REVALIDATING", "QUOTE_VALIDATED", "CHECKOUT_PREPARED", "PIX_DETECTED", "WALLET_REQUIRED", "WALLET_CONNECTED", "FUNDS_CHECKED", "SHIELD_REQUIRED", "PAYMENT_READY", "PAYMENT_AUTHORIZED"];

const tokenKey = (id: string) => `upay3food.run.${id}`;
/** Rounded up to 0,01, like the runtime's timeline. */
const usdc = (units: string) => `${(Number((BigInt(units) + 9_999n) / 10_000n) / 100).toFixed(2).replace(".", ",")} USDC`;

async function call(path: string, token: string, body?: unknown) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-run-token": token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const json = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; run?: RunView };
  if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
  return json;
}

export function RunPanel({ request, runtime }: { request: string; runtime: { configured: boolean; demo: boolean } }) {
  const [run, setRun] = useState<{ id: string; token: string; executor: "extension" | "demo" } | null>(null);
  const [view, setView] = useState<RunView | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const source = useRef<EventSource | null>(null);

  useEffect(() => () => source.current?.close(), []);

  const follow = useCallback((id: string, token: string) => {
    source.current?.close();
    setLines([]);
    const es = new EventSource(`/api/runs/${id}/events?token=${encodeURIComponent(token)}`);
    es.addEventListener("run-event", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as { event: { seq: number; at: string }; run: RunView; message: string };
      setLines((prev) => (prev.some((l) => l.seq === data.event.seq) ? prev : [...prev, { seq: data.event.seq, at: data.event.at, message: data.message }]));
      setView(data.run);
      if (TERMINAL.includes(data.run.state)) es.close();
    });
    source.current = es;
  }, []);

  async function start(executor: "extension" | "demo") {
    setBusy(true);
    setError(null);
    try {
      let executorId: string | undefined;
      if (executor === "extension") {
        const { requestExecutor } = await import("@nape3/pay");
        const identity = await requestExecutor();
        if ("error" in identity) throw new Error(`${identity.error}. Open the extension popup → settings → Agent runtime.`);
        executorId = identity.executorId;
      }
      const response = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request, executor, executorId }) });
      const body = (await response.json()) as { ok?: boolean; error?: string; run?: RunView; runToken?: string };
      if (!response.ok || !body.run || !body.runToken) throw new Error(body.error ?? `HTTP ${response.status}`);
      try {
        sessionStorage.setItem(tokenKey(body.run.id), body.runToken);
      } catch {
        /* the run is still followed for this page view */
      }
      setRun({ id: body.run.id, token: body.runToken, executor });
      setView(body.run);
      follow(body.run.id, body.runToken);
      if (executor === "extension") void import("@nape3/pay").then((m) => m.notifyRunStarted());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function act(action: string, body: unknown) {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const result = await call(`/api/runs/${run.id}/${action}`, run.token, body);
      if (result.run) setView(result.run);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function connectWallet() {
    setBusy(true);
    setError(null);
    try {
      const { WalletSession } = await import("@nape3/pay");
      const session = new WalletSession();
      await session.connect(false);
      const snapshot = await session.check({ includePrivate: true });
      await act("wallet-state", {
        connected: true,
        address: snapshot.address,
        ...(snapshot.shieldedUsdc !== null ? { shieldedUsdc: snapshot.shieldedUsdc.toString() } : {}),
        ...(snapshot.publicUsdc !== null ? { publicUsdc: snapshot.publicUsdc.toString() } : {}),
        ...(snapshot.solLamports !== null ? { solLamports: snapshot.solLamports.toString() } : {})
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!runtime.configured) {
    return <p className="small muted">Execution runs in the agent runtime (apps/agent-api), which is not configured on this site.</p>;
  }

  if (!run || !view) {
    return (
      <section className={`paper ${styles.box}`}>
        <span className="eyebrow">Execute with the agent</span>
        <p className="small">
          The agent re-reads the price in your own iFood session before anything can be paid. A price seen elsewhere is never executed directly.
        </p>
        <div className={styles.row}>
          <button className="btn" disabled={busy} onClick={() => void start("extension")}>Start in my browser</button>
          {runtime.demo && (
            <button className="btn ghost" disabled={busy} onClick={() => void start("demo")}>Run simulated demo</button>
          )}
        </div>
        {error && <p className={`warn small ${styles.error}`}>{error}</p>}
      </section>
    );
  }

  const p = view.payment;
  const demo = run.executor === "demo";
  const request_ = p.confirmationRequest;

  return (
    <section className={`paper ${styles.box}`} aria-live="polite">
      <div className={styles.head}>
        <span className="eyebrow">Agent run · {view.executionMode}{demo ? " · synthetic demo" : ""}</span>
        <span className={`num ${styles.state}`}>{view.state}</span>
      </div>
      <ol className={styles.timeline}>
        {lines.map((l) => (
          <li key={l.seq}>
            <span className="num muted">{new Date(l.at).toLocaleTimeString("pt-BR")}</span>
            <span>{l.message}</span>
          </li>
        ))}
      </ol>
      {view.waitingOnUser && <p className={`warn small ${styles.error}`}>In your browser: {view.waitingOnUser}</p>}

      {(view.state === "WALLET_REQUIRED" || view.state === "WALLET_CONNECTED" || view.state === "SHIELD_REQUIRED") && (
        <div className={styles.row}>
          {!demo && <button className="btn" disabled={busy} onClick={() => void connectWallet()}>{view.state === "SHIELD_REQUIRED" ? "Re-check funds" : "Connect wallet"}</button>}
          {view.state === "SHIELD_REQUIRED" && !demo && <a className="btn ghost" href="/wallet">Shield in Wallet</a>}
          {demo && (
            <button className="btn ghost" disabled={busy} onClick={() => void act("wallet-state", { connected: true, address: DEMO_WALLET, shieldedUsdc: "25000000" })}>
              Use simulated wallet (demo)
            </button>
          )}
        </div>
      )}

      {view.state === "USER_CONFIRMATION" && request_ && (
        <div className={`night ${styles.confirm}`}>
          <span className="eyebrow">Confirm payment</span>
          <p className={`num ${styles.amount}`}>{brl(request_.amountCents)}</p>
          <p className="small">
            {usdc(request_.grossUsdc)} leave the Cloak shielded pool (wallet {request_.walletAddress.slice(0, 4)}…{request_.walletAddress.slice(-4)}). Pix itself is not private.
          </p>
          <div className={styles.row}>
            <button className="btn light" disabled={busy} onClick={() => void act("confirm", { digest: request_.digest, amountCents: request_.amountCents })}>
              Confirm {brl(request_.amountCents)}
            </button>
            <button className="btn ghost" style={{ color: "var(--night-ink)", boxShadow: "inset 0 0 0 1.5px var(--night-ink)" }} disabled={busy} onClick={() => void act("confirm", { reject: true })}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {view.state === "PAYMENT_AUTHORIZED" &&
        (view.executionMode === "simulated" ? (
          <div className={styles.row}>
            <button className="btn" disabled={busy} onClick={() => void act("payment", { signature: base58Encode(crypto.getRandomValues(new Uint8Array(64))) })}>
              Submit simulated private funding
            </button>
            <span className="small muted">Simulated: no transaction is signed and no Pix is paid.</span>
          </div>
        ) : (
          <p className="small warn">Settlement is disabled until a licensed off-ramp is integrated.</p>
        ))}

      {CANCELLABLE.includes(view.state) && (
        <div className={styles.row}>
          <button className="btn ghost" disabled={busy} onClick={() => void act("confirm", { reject: true })}>Cancel run</button>
        </div>
      )}
      {view.failure && <p className={`warn small ${styles.error}`}>{view.failure.reason}</p>}
      {error && <p className={`warn small ${styles.error}`}>{error}</p>}
    </section>
  );
}
