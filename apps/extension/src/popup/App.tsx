import { useCallback, useEffect, useState } from "react";
import type { CandidateEvaluation, Decision } from "@nape3/agent";
import { formatBRL, type Cents, type Membership } from "@nape3/domain";
import { errorMessage } from "../shared/log";
import type {
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

async function readActiveTab(): Promise<{ snapshot: PageSnapshot } | { error: PageError }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { error: { kind: "other", message: "No active tab." } };
  if (!tab.url || !/^https:\/\/([a-z0-9-]+\.)*ifood\.com\.br\//i.test(tab.url)) return { error: { kind: "not-ifood" } };
  try {
    const response = (await chrome.tabs.sendMessage(tab.id, { type: "GET_SNAPSHOT" } satisfies ExtensionMessage)) as ExtensionResponse;
    if (!response.ok) return { error: { kind: "other", message: response.error } };
    if (response.type !== "SNAPSHOT") return { error: { kind: "other", message: "Unexpected response." } };
    return { snapshot: response.snapshot };
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
        <input type="checkbox" checked={draft.includeFixtures} onChange={(e) => setDraft({ ...draft, includeFixtures: e.target.checked })} />
        Compare with synthetic fixtures (demo)
      </label>
      <label>
        Observation network endpoint (optional)
        <input placeholder="http://localhost:8787" value={draft.networkEndpoint ?? ""} onChange={(e) => setDraft({ ...draft, networkEndpoint: e.target.value || undefined })} />
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
    try {
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
      if (result.snapshot.cart) {
        const recorded = await send({ type: "RECORD_SNAPSHOT", snapshot: result.snapshot });
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
      if (next.networkEndpoint) {
        const origin = `${new URL(next.networkEndpoint).origin}/*`;
        const granted = await chrome.permissions.request({ origins: [origin] });
        if (!granted) {
          setNotice("Permission to reach the endpoint was not granted; endpoint not saved.");
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
  const total = snapshot?.cart?.totalCents.value ?? snapshot?.pix?.amountCents.value ?? null;

  return (
    <main className="shell">
      <header>
        <span className="eyebrow">UPAY3FOOD.agent</span>
        {snapshot && (
          <span className="context" title={snapshot.detection.signals.join("\n")}>
            {context} · {Math.round(snapshot.detection.confidence * 100)}%
          </span>
        )}
      </header>

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
            <span className="label">Current checkout</span>
            <strong className="price">{money(total)}</strong>
            {snapshot.cart?.merchantName.value && <span className="muted small">{snapshot.cart.merchantName.value}</span>}
            {snapshot.cart && <Breakdown cart={snapshot.cart} />}
          </section>
          <MarketPanel market={market} />
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

      {plan && <DecisionPanel decision={plan.decision} notes={plan.notes} intentError={plan.intentError} agentState={plan.agentState} />}

      {notice && <div className="status">{notice}</div>}

      <button className="secondary" onClick={() => void refresh()} disabled={busy}>
        Read page again
      </button>

      {settings && <SettingsPanel settings={settings} onSave={(s) => void saveSettings(s)} onClear={() => void clearObservations()} />}

      <footer>Visible page data only · no checkout automation · no cookies or tokens</footer>
    </main>
  );
}
