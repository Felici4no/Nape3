import { useCallback, useEffect, useState } from "react";
import type { CandidateEvaluation, Decision } from "@nape3/agent";
import { formatBRL, type Cents, type Membership } from "@nape3/domain";
import { PRIVACY_COPY } from "@nape3/payments/privacy-copy";
import { errorMessage } from "../shared/log";
import { CostXray, MenuValueCard, PriceCard } from "./PriceCard";
import { abbreviateAddress, payability, walletSummary, type WalletStatus } from "../shared/payment";
import type {
  BridgeStatus,
  CartSnapshot,
  ExtensionMessage,
  ExtensionResponse,
  ExtensionSettings,
  Field,
  MarketView,
  PageSnapshot
} from "../shared/types";

type PageError =
  | { kind: "not-ifood" }
  | { kind: "needs-reload"; tabId: number }
  | { kind: "other"; message: string };

async function send(message: ExtensionMessage): Promise<ExtensionResponse> {
  const response = (await chrome.runtime.sendMessage(message)) as ExtensionResponse | undefined;
  if (!response) throw new Error("No response from the extension background.");
  return response;
}

/** "Receiving end does not exist" = the content script is not in this tab (opened before install/reload). */
function isMissingContentScript(error: unknown): boolean {
  return /receiving end does not exist|could not establish connection/i.test(errorMessage(error));
}

async function readActiveTab(): Promise<{ snapshot: PageSnapshot; tabId: number } | { error: PageError }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { error: { kind: "other", message: "No active tab." } };
  if (!tab.url || !/^https:\/\/([a-z0-9-]+\.)*ifood\.com\.br\//i.test(tab.url)) return { error: { kind: "not-ifood" } };
  try {
    const response = (await chrome.tabs.sendMessage(tab.id, { type: "GET_SNAPSHOT" } satisfies ExtensionMessage)) as ExtensionResponse;
    if (!response.ok) return { error: { kind: "other", message: response.error } };
    if (response.type !== "SNAPSHOT") return { error: { kind: "other", message: "Unexpected response." } };
    return { snapshot: response.snapshot, tabId: tab.id };
  } catch (error) {
    if (isMissingContentScript(error)) return { error: { kind: "needs-reload", tabId: tab.id } };
    return { error: { kind: "other", message: errorMessage(error) } };
  }
}

const money = (value: Cents | null | undefined) => (value === null || value === undefined ? "—" : formatBRL(value));

function Confidence({ field }: { field: Field<unknown> }) {
  return (
    <span className={`conf conf-${field.confidence}`} title={field.evidence}>
      {field.confidence}
    </span>
  );
}

function Breakdown({ cart }: { cart: CartSnapshot }) {
  const rows: Array<[string, Field<Cents>, string?]> = [
    ["Subtotal", cart.itemsSubtotalCents],
    ["Delivery fee", cart.deliveryFeeCents],
    ["Service fee", cart.serviceFeeCents],
    ["Discount", cart.discountCents, "−"]
  ];
  return (
    <details className="breakdown">
      <summary>Breakdown {cart.reconciliation && !cart.reconciliation.consistent && <span className="warn"> · does not reconcile ({money(cart.reconciliation.differenceCents as Cents)})</span>}</summary>
      {rows.map(([label, field, sign]) => (
        <div className="kv" key={label}>
          <span>{label}</span>
          <span>
            {sign && field.value ? sign : ""}
            {money(field.value)} <Confidence field={field} />
          </span>
        </div>
      ))}
      {cart.lines.map((line) => (
        <div className="kv small" key={line.sourceTitle}>
          <span>
            {line.quantity}× {line.sourceTitle}
          </span>
          <span>{money(line.lineTotalCents)}</span>
        </div>
      ))}
    </details>
  );
}

function MarketPanel({ market }: { market: MarketView | null }) {
  if (!market) return null;
  if (market.notRecordedReason && !market.observation) {
    return <p className="muted">Not recorded: {market.notRecordedReason}</p>;
  }
  const { summary, comparison } = market;
  if (!summary.sufficient || summary.medianCents === null) {
    return (
      <section className="market">
        <span className="label">Market</span>
        <p>Not enough fresh market data</p>
        <p className="muted small">
          {summary.sampleSize} comparable observation{summary.sampleSize === 1 ? "" : "s"} in the last {summary.freshness.freshWithinMinutes} min.
          {market.notRecordedReason ? ` ${market.notRecordedReason}.` : ""}
        </p>
      </section>
    );
  }
  return (
    <section className="market">
      <span className="label">Market</span>
      <div className="kv">
        <span>Median</span>
        <strong>{money(summary.medianCents)}</strong>
      </div>
      <div className="kv">
        <span>Lowest observed</span>
        <strong>{money(summary.lowestCents)}</strong>
      </div>
      <p className="muted small">
        {summary.sampleSize} fresh observations · newest {summary.freshness.newestAgeMinutes} min ago
      </p>
      {summary.containsSynthetic && <p className="warn small">Includes synthetic fixture data — not real prices.</p>}
      {comparison && <p className="small">{comparison.message}</p>}
    </section>
  );
}

function Candidate({ candidate }: { candidate: CandidateEvaluation }) {
  return (
    <div className="kv small">
      <span>
        {candidate.source} · {candidate.merchantName}
        {candidate.provenance === "synthetic" ? " (synthetic)" : ""}
      </span>
      <span>{money(candidate.totalCents)}</span>
    </div>
  );
}

function DecisionPanel({ decision, notes, intentError, agentState }: { decision: Decision | null; notes: string[]; intentError: string | null; agentState: string }) {
  if (intentError) return <p className="warn">Could not understand the request: {intentError}</p>;
  if (!decision) return null;
  return (
    <section className="decision">
      <span className="label">Agent · {agentState}</span>
      {decision.status === "no-valid-option" ? (
        <p>No valid option. Nothing is recommended.</p>
      ) : (
        <>
          <div className="kv">
            <span>
              Best: {decision.selected!.source} · {decision.selected!.merchantName}
            </span>
            <strong>{money(decision.totalCents)}</strong>
          </div>
          <p className="small">
            Median {money(decision.marketMedianCents)}
            {decision.savings.vsMarketMedianCents !== null && ` · ${money(decision.savings.vsMarketMedianCents)} vs median`}
            {decision.savings.vsCurrentCheckoutCents !== null && ` · ${money(decision.savings.vsCurrentCheckoutCents)} vs your checkout`}
          </p>
          <p className="small muted">
            Confidence {decision.confidence} · observed {decision.freshness.selectedAgeMinutes} min ago
          </p>
          <p className={decision.selected!.executability.executable ? "small" : "small warn"}>{decision.selected!.executability.note}</p>
          {decision.alternatives.length > 0 && (
            <details>
              <summary>{decision.alternatives.length} alternatives</summary>
              {decision.alternatives.map((c) => (
                <Candidate key={c.observationId} candidate={c} />
              ))}
            </details>
          )}
        </>
      )}
      <details>
        <summary>Reasoning</summary>
        <ul className="small">
          {[...notes.map((n) => `Parser: ${n}`), ...decision.reasoning].map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** Dev bridge controls (development only; shown in Debug mode). */
function DevBridgePanel() {
  const [url, setUrl] = useState("https://upay3food.com");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const r = (await chrome.runtime.sendMessage({ type: "GET_BRIDGE_STATUS" } satisfies ExtensionMessage)) as ExtensionResponse;
    if (r.ok && r.type === "BRIDGE_STATUS") setStatus(r.status);
  }
  useEffect(() => {
    void (async () => {
      const r = (await chrome.runtime.sendMessage({ type: "GET_SETTINGS" } satisfies ExtensionMessage)) as ExtensionResponse;
      if (r.ok && r.type === "SETTINGS") {
        setUrl(r.settings.devBridgeUrl || "https://upay3food.com");
        setToken(r.settings.devBridgeToken ?? "");
      }
      await refresh();
    })();
    const id = setInterval(() => void refresh(), 2000);
    return () => clearInterval(id);
  }, []);

  async function saveSettings(patch: Partial<ExtensionSettings>) {
    const r = (await chrome.runtime.sendMessage({ type: "GET_SETTINGS" } satisfies ExtensionMessage)) as ExtensionResponse;
    if (!(r.ok && r.type === "SETTINGS")) throw new Error("could not read settings");
    await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: { ...r.settings, ...patch } } satisfies ExtensionMessage);
  }

  async function start() {
    setError(null);
    try {
      const origin = new URL(url).origin;
      // Host permission for the bridge origin, asked from this click (a user gesture).
      const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
      if (!granted) throw new Error(`permission for ${origin} was not granted`);
      await saveSettings({ devBridgeUrl: origin, devBridgeToken: token.trim() });
      const r = (await chrome.runtime.sendMessage({ type: "BRIDGE_START" } satisfies ExtensionMessage)) as ExtensionResponse;
      if (!r.ok) throw new Error(r.error);
      if (r.type === "BRIDGE_STATUS") setStatus(r.status);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function stop() {
    await saveSettings({ devBridgeEnabled: false, devBridgeSessionId: undefined });
    await refresh();
  }

  return (
    <div className="small">
      <p>
        <strong>Dev bridge</strong> (development): sends each page's sanitized snapshot to the UPAY3FOOD dev endpoint, so the page can be inspected
        remotely. Same sanitization as the capture; the server refuses anything that still looks like personal data. Sessions expire in 30 min.
      </p>
      <label>Bridge URL<input type="text" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} /></label>
      <label>Bridge token (DEV_BRIDGE_TOKEN)<input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></label>
      {status?.enabled && status.sessionId ? (
        <>
          <p>
            Session <code>{status.sessionId}</code> · sent {status.sent}
            {status.lastSentAt ? ` · last ${new Date(status.lastSentAt).toLocaleTimeString("pt-BR")}` : ""}
            {status.lastStatus ? ` · HTTP ${status.lastStatus}` : ""}
          </p>
          {status.lastError && <p className="warn">Last error: {status.lastError}</p>}
          <button className="secondary" onClick={() => void navigator.clipboard.writeText(status.sessionId!)}>Copy session id</button>
          <button className="secondary" onClick={() => void stop()}>Stop bridge</button>
        </>
      ) : (
        <button className="secondary" disabled={!token.trim()} onClick={() => void start()}>Start bridge session</button>
      )}
      {error && <p className="warn">{error}</p>}
    </div>
  );
}

function DebugPanel({ snapshot, market, tabId }: { snapshot: PageSnapshot; market: MarketView | null; tabId: number | null }) {
  const [capture, setCapture] = useState<string | null>(null);
  const [pageCapture, setPageCapture] = useState<string | null>(null);
  const [redactions, setRedactions] = useState("");
  const [structureOnly, setStructureOnly] = useState(false);
  const [connectivity, setConnectivity] = useState<string | null>(null);
  async function runConnectivity() {
    try {
      const response = (await chrome.runtime.sendMessage({ type: "GET_CONNECTIVITY" } satisfies ExtensionMessage)) as ExtensionResponse;
      setConnectivity(response.ok && response.type === "CONNECTIVITY" ? JSON.stringify(response.report, null, 2) : `error: ${response.ok ? "unexpected" : response.error}`);
    } catch (error) {
      setConnectivity(`error: ${errorMessage(error)}`);
    }
  }
  const cart = snapshot.cart;
  const time = (iso: string) => `${new Date(iso).toLocaleTimeString("pt-BR")} (${iso})`;
  async function loadCapture() {
    if (tabId === null) return;
    try {
      const response = (await chrome.tabs.sendMessage(tabId, { type: "GET_DOM_CAPTURE" } satisfies ExtensionMessage)) as ExtensionResponse;
      setCapture(response.ok && response.type === "DOM_CAPTURE" ? response.capture : `error: ${response.ok ? "unexpected" : response.error}`);
    } catch (error) {
      setCapture(`error: ${errorMessage(error)}`);
    }
  }
  async function loadPageCapture() {
    if (tabId === null) return;
    const words = redactions.split(",").map((w) => w.trim()).filter((w) => w.length >= 3);
    try {
      const response = (await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_CAPTURE", redactions: words, structureOnly } satisfies ExtensionMessage)) as ExtensionResponse;
      setPageCapture(response.ok && response.type === "PAGE_CAPTURE" ? response.capture : `error: ${response.ok ? "unexpected" : response.error}`);
    } catch (error) {
      setPageCapture(`error: ${errorMessage(error)}`);
    }
  }
  function downloadPageCapture() {
    if (!pageCapture) return;
    const url = URL.createObjectURL(new Blob([pageCapture], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `upay3food-capture-${snapshot.detection.context.toLowerCase()}-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <details className="debug" open>
      <summary>Debug</summary>
      <div className="kv small"><span>Extracted at</span><span>{time(snapshot.capturedAt)}</span></div>
      <div className="kv small"><span>Snapshot id</span><span>{snapshot.snapshotId}</span></div>
      <div className="kv small">
        <span>Observation</span>
        <span>{market?.observation ? `${market.observation.id} · observedAt ${time(market.observation.observedAt)}` : market?.notRecordedReason ?? "—"}</span>
      </div>
      <p className="small">Context signals: {snapshot.detection.signals.join(" · ")}</p>
      {cart && (
        <>
          <p className="small">
            Summary containers: {cart.summarySelection.candidates} · chosen: {cart.summarySelection.chosen ?? "none"}
          </p>
          {cart.summarySelection.rejected.map((r) => (
            <p className="small muted" key={r}>rejected {r}</p>
          ))}
          <p className="small">Validity: {cart.validity.valid ? "valid" : cart.validity.reasons.join("; ")}</p>
          <ul className="small evidence">
            {(
              [
                ["subtotal", cart.itemsSubtotalCents],
                ["delivery", cart.deliveryFeeCents],
                ["service", cart.serviceFeeCents],
                ["discount", cart.discountCents],
                ["total", cart.totalCents]
              ] as Array<[string, Field<Cents>]>
            ).map(([name, f]) => (
              <li key={name}>{name}: {money(f.value)} [{f.confidence}] {f.evidence}</li>
            ))}
            {cart.lines.map((l) => (
              <li key={l.sourceTitle}>line: {l.quantity}× {l.sourceTitle} {money(l.lineTotalCents)} {l.evidence}</li>
            ))}
          </ul>
        </>
      )}
      <button className="secondary" onClick={() => void runConnectivity()}>Run connectivity test</button>
      <DevBridgePanel />
      {connectivity && <textarea readOnly value={connectivity} rows={8} />}
      <p className="small">
        <strong>Calibration capture (any page).</strong> Detected context, signals, what was extracted and a sanitized page structure.
        Header, navigation, footer and input values are left out. E-mails, phones, CEPs, CPFs, long numbers, street addresses and Pix codes are removed.
      </p>
      <label className="small">
        Extra words to remove (comma-separated: your name, street…). Used once, never stored.
        <input type="text" autoComplete="off" spellCheck={false} value={redactions} onChange={(e) => setRedactions(e.target.value)} />
      </label>
      <label className="small">
        <input type="checkbox" checked={structureOnly} onChange={(e) => setStructureOnly(e.target.checked)} /> Structure only: hide all text except
        interface words (use it while the address picker or its suggestions are open)
      </label>
      <button className="secondary" onClick={() => void loadPageCapture()}>Capture this page ({snapshot.detection.context})</button>
      {pageCapture && (
        <>
          <p className="small warn">Review before sharing. Search it for your name, street and phone before sending.</p>
          <textarea readOnly value={pageCapture} rows={10} onFocus={(e) => e.currentTarget.select()} />
          <button className="secondary" onClick={() => void navigator.clipboard.writeText(pageCapture)}>Copy</button>
          <button className="secondary" onClick={downloadPageCapture}>Download .txt</button>
        </>
      )}
      <button className="secondary" onClick={() => void loadCapture()}>Capture order DOM (for calibration)</button>
      {capture && (
        <>
          <p className="small warn">Review before sharing: scrubbed automatically, but check for names or addresses.</p>
          <textarea readOnly value={capture} rows={10} onFocus={(e) => e.currentTarget.select()} />
          <button className="secondary" onClick={() => void navigator.clipboard.writeText(capture)}>Copy</button>
        </>
      )}
    </details>
  );
}

function WalletPanel({ status }: { status: WalletStatus | null }) {
  const summary = walletSummary(status, new Date());
  return (
    <section className="wallet">
      <div className="kv">
        <span className="label">Wallet</span>
        <span className={summary.connected ? "small" : "small muted"} title={status?.address}>
          {summary.label}
        </span>
      </div>
      {summary.connected && (
        <>
          <div className="kv small"><span>Public USDC</span><span>{summary.publicUsdc}</span></div>
          <div className="kv small">
            <span>Shielded USDC (Cloak)</span>
            <span>{summary.shieldedUsdc ?? "locked: unlock when paying"}</span>
          </div>
          <span className={`small ${summary.stale ? "warn" : "muted"}`}>
            checked {summary.ageMinutes === 0 ? "just now" : `${summary.ageMinutes} min ago`}
            {status?.agentState ? ` · ${status.agentState}` : ""}
          </span>
        </>
      )}
    </section>
  );
}

/** Entry to the payment flow; the purchase continues on the UPAY3FOOD Pay screen. */
function PayPanel({ snapshot, wallet, onError }: { snapshot: PageSnapshot; wallet: WalletStatus | null; onError: (m: string) => void }) {
  const pay = payability(snapshot);
  if (!pay.payable) {
    return <p className="small muted">Crypto payment unavailable: {pay.reason}.</p>;
  }
  async function start() {
    try {
      const response = await send({ type: "CREATE_PAYMENT", snapshot });
      if (!response.ok) return onError(response.error);
      if (response.type === "PAYMENT_CREATED") await chrome.tabs.create({ url: response.url });
    } catch (error) {
      onError(errorMessage(error));
    }
  }
  return (
    <section className="pay">
      <strong>{PRIVACY_COPY.headline}</strong>
      <button className="pay-button" onClick={() => void start()}>
        Pay {money(pay.amountCents)} with crypto
      </button>
      <span className="small muted">
        {wallet ? `From ${abbreviateAddress(wallet.address)} · funded privately via Cloak` : "Connects your Solana wallet (Phantom or Solflare) first"}
        {" · "}
        {pay.destination === "pix-payload-via-offramp" ? "Pix Copia e Cola detected" : "Pix selected at checkout"}
      </span>
      <details>
        <summary className="small">What stays private?</summary>
        <p className="small">{PRIVACY_COPY.whatIsHidden}</p>
        <p className="small muted">{PRIVACY_COPY.whatIsNotHidden}</p>
      </details>
    </section>
  );
}

const REGIONS = ["", "BR-SP-sao-paulo", "BR-RJ-rio-de-janeiro", "BR-MG-belo-horizonte", "BR-DF-brasilia", "BR-PR-curitiba"];
const MEMBERSHIPS: Membership[] = ["unknown", "none", "ifood-club", "rappi-prime", "other"];

function SettingsPanel({ settings, onSave, onClear }: { settings: ExtensionSettings; onSave: (s: ExtensionSettings) => void; onClear: () => void }) {
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  return (
    <details className="settings">
      <summary>Settings & privacy</summary>
      <label>
        Region (coarse)
        <select value={draft.marketRegion ?? ""} onChange={(e) => setDraft({ ...draft, ...(e.target.value ? { marketRegion: e.target.value } : { marketRegion: undefined }) })}>
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {r || "not set"}
            </option>
          ))}
        </select>
      </label>
      <label>
        Membership
        <select value={draft.membership} onChange={(e) => setDraft({ ...draft, membership: e.target.value as Membership })}>
          {MEMBERSHIPS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
      <label className="inline">
        <input type="checkbox" checked={draft.showBadge} onChange={(e) => setDraft({ ...draft, showBadge: e.target.checked })} />
        On-page badge (experimental; mounted only after the page loads)
      </label>
      <label className="inline">
        <input type="checkbox" checked={draft.debug} onChange={(e) => setDraft({ ...draft, debug: e.target.checked })} />
        Debug mode (timestamps, evidence, DOM capture)
      </label>
      <label className="inline">
        <input type="checkbox" checked={draft.includeFixtures} onChange={(e) => setDraft({ ...draft, includeFixtures: e.target.checked })} />
        Also compare with synthetic fixtures (demo, labelled)
      </label>
      <label>
        Private funding page
        <input value={draft.fundingAppUrl} onChange={(e) => setDraft({ ...draft, fundingAppUrl: e.target.value })} />
      </label>
      <label>
        Observation network endpoint (optional)
        <input placeholder="http://localhost:8787" value={draft.networkEndpoint ?? ""} onChange={(e) => setDraft({ ...draft, networkEndpoint: e.target.value || undefined })} />
      </label>
      <label>
        Agent runtime (agent-api, optional)
        <input placeholder="http://localhost:8788" value={draft.agentApiUrl ?? ""} onChange={(e) => setDraft({ ...draft, agentApiUrl: e.target.value || undefined })} />
      </label>
      <label>
        Network read token (optional)
        <input type="password" autoComplete="off" value={draft.networkReadToken ?? ""} onChange={(e) => setDraft({ ...draft, networkReadToken: e.target.value || undefined })} />
      </label>
      <p className="muted small">Only commercial data is stored or sent: items, fees, totals, ETA, coarse region. Never cookies, tokens, addresses or account data.</p>
      <div className="actions">
        <button onClick={() => onSave(draft)}>Save</button>
        <button className="secondary" onClick={onClear}>
          Clear local observations
        </button>
      </div>
    </details>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [wallet, setWallet] = useState<WalletStatus | null>(null);
  const [pageError, setPageError] = useState<PageError | null>(null);
  const [market, setMarket] = useState<MarketView | null>(null);
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [request, setRequest] = useState("quero açaí 500ml até R$25");
  const [plan, setPlan] = useState<Extract<ExtensionResponse, { type: "PLAN" }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    setPlan(null);
    // Never show the previous state next to a new extraction.
    setSnapshot(null);
    setMarket(null);
    try {
      const walletResponse = await send({ type: "GET_WALLET_STATUS" });
      if (walletResponse.ok && walletResponse.type === "WALLET_STATUS") setWallet(walletResponse.status);
      const settingsResponse = await send({ type: "GET_SETTINGS" });
      if (settingsResponse.ok && settingsResponse.type === "SETTINGS") setSettings(settingsResponse.settings);
      const result = await readActiveTab();
      if ("error" in result) {
        setPageError(result.error);
        setSnapshot(null);
        return;
      }
      setPageError(null);
      setSnapshot(result.snapshot);
      setTabId(result.tabId);
      if (result.snapshot.cart) {
        const recorded = await send({ type: "RECORD_SNAPSHOT", snapshot: result.snapshot, tabId: result.tabId });
        if (recorded.ok && recorded.type === "MARKET") setMarket(recorded.market);
        else if (!recorded.ok) setNotice(recorded.error);
      } else {
        setMarket(null);
      }
    } catch (error) {
      setPageError({ kind: "other", message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function findBetter() {
    setBusy(true);
    try {
      const response = await send({ type: "PLAN_INTENT", request, snapshot });
      if (response.ok && response.type === "PLAN") setPlan(response);
      else if (!response.ok) setNotice(response.error);
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(next: ExtensionSettings) {
    try {
      const origins = [next.networkEndpoint, next.agentApiUrl].filter((u): u is string => !!u).map((u) => `${new URL(u).origin}/*`);
      if (origins.length) {
        const granted = await chrome.permissions.request({ origins });
        if (!granted) {
          setNotice("Permission to reach the endpoint was not granted; settings not saved.");
          return;
        }
      }
      const response = await send({ type: "SAVE_SETTINGS", settings: next });
      if (response.ok && response.type === "SETTINGS") setSettings(response.settings);
      setNotice("Settings saved.");
      void refresh();
    } catch (error) {
      setNotice(`Invalid settings: ${errorMessage(error)}`);
    }
  }

  async function clearObservations() {
    await send({ type: "CLEAR_OBSERVATIONS" });
    setNotice("Local observations cleared.");
    void refresh();
  }

  const context = snapshot?.detection.context;
  const cartInvalid = snapshot?.cart ? !snapshot.cart.validity.valid : false;
  // Only a validated cart total (or a Pix amount when there is no summary). Never an item price.
  const total = snapshot?.cart ? (cartInvalid ? null : snapshot.cart.totalCents.value) : (snapshot?.pix?.amountCents.value ?? null);

  // The third layer only against real, fresh, comparable observations.
  const cheapest = market && market.summary.sufficient && !market.summary.containsSynthetic ? market.summary.lowestCents : null;

  return (
    <main className="shell">
      <header className="top">
        <span className="brand">
          UPAY<span className="brand__three">3</span>FOOD
        </span>
        {snapshot && (
          <span className="context" title={snapshot.detection.signals.join("\n")}>
            {context} · {Math.round(snapshot.detection.confidence * 100)}%
          </span>
        )}
      </header>

      <WalletPanel status={wallet} />

      {busy && <div className="status">Reading…</div>}

      {pageError?.kind === "not-ifood" && <div className="status">Open an iFood page (ifood.com.br) to observe prices.</div>}
      {pageError?.kind === "needs-reload" && (
        <div className="status warn">
          <p>This tab was opened before the extension was installed or updated, so it cannot be read yet.</p>
          <button onClick={() => chrome.tabs.reload(pageError.tabId).then(() => window.close())}>Reload iFood tab</button>
        </div>
      )}
      {pageError?.kind === "other" && <div className="status warn">{pageError.message}</div>}

      {snapshot && (context === "CART" || context === "CHECKOUT" || context === "PIX_PAYMENT") && (
        <>
          <section className="current">
            {(cartInvalid || !snapshot.cart) && <span className="label">Current checkout</span>}
            {cartInvalid ? (
              <>
                <strong className="price warn">Not validated</strong>
                {snapshot.cart!.validity.reasons.map((r) => (
                  <span className="warn small" key={r}>{r}</span>
                ))}
                <span className="muted small">Not recorded and not used by the agent.</span>
              </>
            ) : (
              snapshot.cart ? <PriceCard snapshot={snapshot} cheapestComparableCents={cheapest} /> : <strong className="price display num">{money(total)}</strong>
            )}
            {snapshot.cart && <Breakdown cart={snapshot.cart} />}
          </section>
          {!cartInvalid && <MarketPanel market={market} />}
        </>
      )}

      {snapshot?.pix && snapshot.pix.preferredEvidence && (
        <section className="pix">
          <span className="label">Pix detected</span>
          <div className="kv small">
            <span>Evidence</span>
            <span>{snapshot.pix.preferredEvidence}</span>
          </div>
          <div className="kv small">
            <span>Amount</span>
            <span>
              {money(snapshot.pix.amountCents.value)} <Confidence field={snapshot.pix.amountCents} />
            </span>
          </div>
          {snapshot.pix.parsedPayload && (
            <div className="kv small">
              <span>Payload CRC</span>
              <span className={snapshot.pix.parsedPayload.crcValid ? "" : "warn"}>{snapshot.pix.parsedPayload.crcValid ? "valid" : "INVALID"}</span>
            </div>
          )}
          {snapshot.pix.expiresAt.value && (
            <div className="kv small">
              <span>Expires</span>
              <span>{new Date(snapshot.pix.expiresAt.value).toLocaleTimeString("pt-BR")}</span>
            </div>
          )}
          <p className="muted small">Payment is not executed by UPAY3FOOD in this version.</p>
        </section>
      )}

      {snapshot && (context === "CHECKOUT" || context === "PIX_PAYMENT") && (
        <PayPanel snapshot={snapshot} wallet={wallet} onError={setNotice} />
      )}

      {snapshot?.restaurant && (
        <section>
          <span className="label">Restaurant</span>
          <div className="kv small">
            <span>{snapshot.restaurant.merchantName.value ?? "Merchant not detected"}</span>
            <Confidence field={snapshot.restaurant.merchantName} />
          </div>
          <div className="kv small">
            <span>Delivery fee</span>
            <span>{money(snapshot.restaurant.deliveryFeeCents.value)}</span>
          </div>
          <p className="muted small">Item prices are not checkout prices; add to cart to compare totals.</p>
        </section>
      )}

      {snapshot?.merchant && !snapshot.restaurant && (
        <section>
          <span className="label">Restaurant</span>
          <div className="kv small">
            <span>{snapshot.merchant.name ?? snapshot.merchant.slug}</span>
            <span className="muted">{snapshot.merchant.via === "url" ? "from link" : "from restaurant page"}</span>
          </div>
        </section>
      )}

      {snapshot?.product && <PriceCard snapshot={snapshot} cheapestComparableCents={cheapest} />}
      {snapshot && (snapshot.product || (snapshot.cart?.validity.valid && snapshot.cart.lines.length === 1)) && <CostXray snapshot={snapshot} />}
      {snapshot?.restaurant?.menu && <MenuValueCard menu={snapshot.restaurant.menu} />}

      {snapshot?.product && (
        <section>
          <span className="label">Product</span>
          <div className="kv small">
            <span>{snapshot.product.title.value ?? "Not detected"}</span>
            <span>{money(snapshot.product.unitPriceCents.value)}</span>
          </div>
          <p className="muted small">Item price only — fees are added at checkout.</p>
        </section>
      )}

      <section className="intent">
        <label className="label" htmlFor="intent">
          Purchase intent
        </label>
        <input id="intent" value={request} onChange={(e) => setRequest(e.target.value)} />
        <button onClick={() => void findBetter()} disabled={busy || !request.trim()}>
          Find better option
        </button>
      </section>

      {plan && !plan.currentCheckout.used && snapshot?.cart && (
        <p className="small warn">Your checkout was not used by the agent: {plan.currentCheckout.reason}</p>
      )}
      {plan && <DecisionPanel decision={plan.decision} notes={plan.notes} intentError={plan.intentError} agentState={plan.agentState} />}

      {settings?.debug && snapshot && <DebugPanel snapshot={snapshot} market={market} tabId={tabId} />}

      {notice && <div className="status">{notice}</div>}

      <button className="secondary" onClick={() => void refresh()} disabled={busy}>
        Read page again
      </button>

      {settings && <SettingsPanel settings={settings} onSave={(s) => void saveSettings(s)} onClear={() => void clearObservations()} />}

      <footer>Visible page data only · no checkout automation · no cookies or tokens</footer>
    </main>
  );
}
