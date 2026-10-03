import { useEffect, useState } from "react";
import type {
  ExtensionResponse,
  RawOffer
} from "../shared/types";

function formatBrl(cents: number | null): string {
  if (cents === null) return "Not detected";

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(cents / 100);
}

async function getActiveTabOffer(): Promise<RawOffer> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) {
    throw new Error("No active tab.");
  }

  if (!tab.url?.includes("ifood.com.br")) {
    throw new Error("Open an iFood page first.");
  }

  const response = (await chrome.tabs.sendMessage(tab.id, {
    type: "GET_CURRENT_OFFER"
  })) as ExtensionResponse;

  if (!response.ok || !response.offer) {
    throw new Error(response.ok ? "No offer detected." : response.error);
  }

  return response.offer;
}

export function App() {
  const [offer, setOffer] = useState<RawOffer | null>(null);
  const [status, setStatus] = useState("Reading current page…");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    try {
      setStatus("Reading current page…");
      const currentOffer = await getActiveTabOffer();
      setOffer(currentOffer);
      setStatus("iFood detected");
    } catch (error) {
      setOffer(null);
      setStatus(error instanceof Error ? error.message : "Unable to read page.");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function save() {
    if (!offer) return;

    setSaving(true);

    const response = (await chrome.runtime.sendMessage({
      type: "SAVE_OFFER",
      payload: offer
    })) as ExtensionResponse;

    setSaving(false);
    setStatus(response.ok ? "Offer captured ✓" : response.error);
  }

  return (
    <main className="shell">
      <header>
        <span className="eyebrow">NAPE3 / OBSERVER</span>
        <h1>Current offer</h1>
      </header>

      <div className="status">{status}</div>

      {offer && (
        <section className="offer">
          <div>
            <span className="label">Product</span>
            <strong>{offer.productName ?? "Not detected"}</strong>
          </div>

          <div>
            <span className="label">Merchant</span>
            <strong>{offer.merchantName ?? "Not detected"}</strong>
          </div>

          <div>
            <span className="label">Visible price</span>
            <strong className="price">{formatBrl(offer.itemPriceCents)}</strong>
          </div>

          <button onClick={save} disabled={saving}>
            {saving ? "Capturing…" : "Capture offer"}
          </button>
        </section>
      )}

      <button className="secondary" onClick={refresh}>
        Read page again
      </button>

      <footer>
        Visible page data only · no checkout automation
      </footer>
    </main>
  );
}
