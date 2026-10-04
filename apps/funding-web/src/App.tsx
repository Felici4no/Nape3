import { useEffect, useMemo, useState } from "react";
import { address, createCloakRpc } from "@cloak.dev/sdk";
import type { AgentState } from "@nape3/agent";
import { formatBRL } from "@nape3/domain";
import { MockOfframp, USDC_MINT, formatUsdcDisplay as formatUsdc } from "@nape3/payments";
import {
  CloakFunding,
  CloakKeys,
  createCloakLogger,
  derivationMessageBytes,
  grossUpWithdrawal,
  PRIVACY_COPY,
  readPublicBalances,
  realCloakSdk,
  seedFromWalletSignature
} from "@nape3/payments/cloak";
import { connectedToExtension, loadPaymentRequest, reportDisconnected, reportToExtension } from "./bridge";
import { EncryptedLocalNoteStore } from "./encrypted-store";
import { PaymentFlow, settlementUnavailable, type FlowView, type PaymentRequest, type PrivateBalance } from "./flow";
import { connectWallet, findWallet, type ConnectedWallet } from "./wallet";

const USDC = address(USDC_MINT["mainnet-beta"]);
const RPC_KEY = "upay3food.rpc";
const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
const log = createCloakLogger((line) => console.info(line));

const STEPS: Array<{ title: string; states: AgentState[] }> = [
  { title: "Wallet", states: ["PAYMENT_TARGET_DETECTED", "WALLET_REQUIRED", "WALLET_CONNECTED"] },
  { title: "Private funds", states: ["FUNDS_CHECKED", "SHIELD_REQUIRED"] },
  { title: "Confirm", states: ["PAYMENT_READY", "PAYMENT_AUTHORIZED", "SETTLED"] }
];

const DESTINATION_LABEL = {
  "pix-payload-via-offramp": "Pix Copia e Cola, paid by a USDC→BRL off-ramp",
  "pix-selected-via-offramp": "Pix (code issued after the order), paid by a USDC→BRL off-ramp"
} as const;

function rpcUrl(): string {
  return localStorage.getItem(RPC_KEY) || DEFAULT_RPC;
}

/** Wires the flow to the real wallet, RPC, Cloak SDK and the extension. */
function createFlow(request: PaymentRequest): PaymentFlow {
  let connected: ConnectedWallet | null = null;
  return new PaymentFlow(
    {
      connectWallet: async ({ silent }) => {
        connected = await connectWallet({ silent });
        return connected;
      },
      unlockPrivateBalance: async (): Promise<PrivateBalance> => {
        if (!connected) throw new Error("wallet not connected");
        // One signature (not a transaction): derives the Cloak key and the local note-encryption key.
        const signature = await connected.signMessage(derivationMessageBytes());
        const keys = await CloakKeys.fromSeed(await seedFromWalletSignature(signature));
        const funding = new CloakFunding({
          sdk: realCloakSdk,
          connection: createCloakRpc(rpcUrl()),
          signer: connected.cloakSigner(),
          keys,
          store: await EncryptedLocalNoteStore.create(connected.address, signature),
          mint: USDC,
          log
        });
        return {
          shieldedUsdc: async () => (await funding.shieldedBalance()).total,
          shield: (amount) => funding.shield(amount)
        };
      },
      readPublicBalances: (owner) => readPublicBalances(createCloakRpc(rpcUrl()), address(owner), USDC),
      quote: async (amountCents) => {
        const quote = await new MockOfframp().quote(amountCents, new Date());
        return { offrampNetUsdc: quote.usdcRequired, grossUsdc: grossUpWithdrawal(quote.usdcRequired), simulated: true };
      },
      settle: settlementUnavailable,
      report: (context, extra) => reportToExtension(context, extra.shieldedUsdc, request),
      now: () => new Date()
    },
    request
  );
}

function Stepper({ state }: { state: AgentState }) {
  const current = STEPS.findIndex((s) => s.states.includes(state));
  return (
    <ol className="stepper">
      {STEPS.map((step, i) => (
        <li key={step.title} className={i < current ? "done" : i === current ? "current" : ""}>
          <span>{i < current ? "✓" : i + 1}</span> {step.title}
        </li>
      ))}
    </ol>
  );
}

function Balances({ view }: { view: FlowView }) {
  const funds = view.agent.funds;
  const req = view.agent.fundingRequirement;
  if (!funds || !req) return null;
  return (
    <div className="card">
      <div className="kv"><span>Public USDC</span><span>{formatUsdc(funds.publicUsdc)}</span></div>
      <div className="kv"><span>Shielded USDC (Cloak)</span><span>{formatUsdc(funds.shieldedUsdc)}</span></div>
      <div className="kv strong"><span>Needed for this order</span><span>{formatUsdc(req.grossUsdc)}</span></div>
    </div>
  );
}

function Body({ flow, view }: { flow: PaymentFlow; view: FlowView }) {
  const { agent } = view;
  const busy = view.busy !== null;
  switch (agent.state) {
    case "PAYMENT_TARGET_DETECTED":
    case "WALLET_REQUIRED":
      return (
        <div className="step">
          <h2>Connect your wallet</h2>
          <p>Pay with USDC from your Solana wallet. Funds are moved through Cloak's shielded pool before settlement.</p>
          <button className="primary" disabled={busy || !findWallet()} onClick={() => void flow.connect()}>
            {findWallet() ? `Connect ${findWallet()!.name}` : "Install Phantom or Solflare to continue"}
          </button>
          <p className="fine">UPAY3FOOD never asks for your seed phrase or private key. Your wallet signs; we never see your keys.</p>
        </div>
      );
    case "WALLET_CONNECTED":
    case "FUNDS_CHECKED":
      return (
        <div className="step">
          <h2>Check your private balance</h2>
          <p>Your wallet will ask you to sign one message. It is not a transaction: it unlocks your shielded balance on this device.</p>
          <button className="primary" disabled={busy} onClick={() => void flow.checkFunds()}>
            Check balances
          </button>
        </div>
      );
    case "SHIELD_REQUIRED": {
      const a = agent.fundingAssessment;
      if (a?.kind !== "shield-required") return null;
      return (
        <div className="step">
          <h2>Move funds into your private balance</h2>
          <Balances view={view} />
          {a.canShield ? (
            <>
              <p>
                Shield {formatUsdc(a.shieldAmountUsdc)} from your wallet into Cloak. You'll approve one transaction; the
                privacy proof is generated on this device.
              </p>
              <button className="primary" disabled={busy} onClick={() => void flow.shieldRequired()}>
                Shield required amount ({formatUsdc(a.shieldAmountUsdc)})
              </button>
              <p className="fine">{PRIVACY_COPY.tip}</p>
            </>
          ) : a.reason === "insufficient-public-usdc" ? (
            <>
              <p className="warn">
                Not enough USDC. Add at least {formatUsdc(a.addPublicUsdc)} to this wallet, then check again.
              </p>
              <button className="secondary" disabled={busy} onClick={() => void flow.checkFunds()}>Check again</button>
            </>
          ) : (
            <>
              <p className="warn">Add a little SOL (about 0.01) to this wallet for network fees, then check again.</p>
              <button className="secondary" disabled={busy} onClick={() => void flow.checkFunds()}>Check again</button>
            </>
          )}
        </div>
      );
    }
    case "PAYMENT_READY": {
      const req = agent.fundingRequirement!;
      return (
        <div className="step">
          <h2>Confirm payment</h2>
          <div className="card">
            <div className="kv strong"><span>Checkout total</span><span>{formatBRL(req.checkoutTotalCents)}</span></div>
            <div className="kv"><span>Funding (estimated)</span><span>{formatUsdc(req.grossUsdc)}</span></div>
            <div className="kv sub"><span>· Cloak privacy fee</span><span>{formatUsdc(req.cloakFeeUsdc)}</span></div>
            <div className="kv sub"><span>· Off-ramp receives</span><span>{formatUsdc(req.offrampNetUsdc)}</span></div>
            <div className="kv"><span>From</span><span>Your shielded balance (Cloak)</span></div>
            <div className="kv"><span>Destination</span><span>{DESTINATION_LABEL[req.destination]}</span></div>
          </div>
          {req.quoteSimulated && <p className="fine warn">USDC amounts use a simulated off-ramp quote: no licensed provider is integrated yet.</p>}
          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => void flow.confirm()}>Confirm {formatBRL(req.checkoutTotalCents)}</button>
            <button className="secondary" disabled={busy} onClick={() => flow.reject()}>Cancel</button>
          </div>
        </div>
      );
    }
    case "PAYMENT_AUTHORIZED":
    case "SETTLED":
      return (
        <div className="step">
          <h2>{view.settlement?.settled ? "Paid" : "Payment authorized: not settled"}</h2>
          <p className={view.settlement?.settled ? "" : "warn"}>{view.settlement?.text}</p>
          <button className="secondary" onClick={() => window.close()}>Back to checkout</button>
        </div>
      );
    case "IDLE":
      return (
        <div className="step">
          <h2>Payment cancelled</h2>
          <p>Nothing was charged.</p>
          <button className="secondary" onClick={() => window.close()}>Back to checkout</button>
        </div>
      );
    default:
      return <p className="warn">Unexpected state: {agent.state}</p>;
  }
}

export function App() {
  const [request, setRequest] = useState<PaymentRequest | null | undefined>(undefined);
  const flow = useMemo(() => (request ? createFlow(request) : null), [request]);
  const [view, setView] = useState<FlowView | null>(null);
  const [rpc, setRpc] = useState(rpcUrl());

  useEffect(() => {
    void loadPaymentRequest().then(setRequest);
  }, []);

  useEffect(() => {
    if (!flow) return;
    const unsubscribe = flow.subscribe(setView);
    void flow.start();
    return unsubscribe;
  }, [flow]);

  if (request === undefined) return <main className="sheet"><p className="muted">Loading checkout…</p></main>;
  if (request === null || !flow || !view) {
    return (
      <main className="sheet">
        <header><span className="brand">UPAY3FOOD Pay</span></header>
        <h1>No checkout to pay</h1>
        <p>Open UPAY3FOOD.agent on an iFood checkout with Pix and choose “Pay with crypto”.</p>
      </main>
    );
  }

  return (
    <main className="sheet">
      <header>
        <span className="brand">UPAY3FOOD Pay</span>
        {view.wallet && (
          <button className="link" onClick={() => { flow.disconnect(); reportDisconnected(); }}>
            {view.wallet.name} · {view.wallet.address.slice(0, 4)}…{view.wallet.address.slice(-4)} · disconnect
          </button>
        )}
      </header>

      <section className="order">
        <span className="muted">{request.merchant ?? "iFood checkout"} · {request.destination === "pix-payload-via-offramp" ? "Pix detected" : "Pix selected"}</span>
        <div className="total">{formatBRL(request.amountCents)}</div>
        <span className="privacy">🛡 {PRIVACY_COPY.headline}</span>
      </section>

      <Stepper state={view.agent.state} />
      <Body flow={flow} view={view} />

      {view.busy && <p className="status">{view.busy}</p>}
      {view.notice && (
        <p className={`status ${view.notice.kind === "error" ? "warn" : view.notice.kind === "success" ? "ok" : ""}`}>
          {view.notice.text}
          {view.notice.kind === "success" && view.notice.link && (
            <> · <a href={view.notice.link} target="_blank" rel="noreferrer">view transaction</a></>
          )}
        </p>
      )}

      <details className="explain">
        <summary>What stays private?</summary>
        <p>{PRIVACY_COPY.whatIsHidden}</p>
        <p>{PRIVACY_COPY.whatIsNotHidden}</p>
      </details>
      <details className="advanced">
        <summary>Advanced</summary>
        <label>
          Solana RPC
          <input value={rpc} onChange={(e) => setRpc(e.target.value)} onBlur={() => localStorage.setItem(RPC_KEY, rpc)} />
        </label>
        <p className="fine">{connectedToExtension() ? "Linked to UPAY3FOOD.agent" : "Not opened from the extension"} · state {view.agent.state}</p>
      </details>
    </main>
  );
}

