"use client";

import { useEffect, useState } from "react";
import styles from "./money.module.css";

interface Latest {
  count: number;
  snapshot: {
    capturedAt: string;
    receivedAt: string;
    context: string;
    detection: { confidence: number; signals: string[] };
    extracted: Record<string, unknown>;
    sanitizedStructure: string;
    diagnostics: { extensionVersion: string; navigationType: string | null; pageAgeSeconds: number | null; path: string };
    searchResults?: { visibleCount: number } | null;
  };
}

/**
 * /dev/bridge#<sessionId>: the latest sanitized snapshot the extension sent,
 * refreshed every 3 s. Development only; the session id stays in the URL
 * fragment (never sent to the server in a request line or logs).
 */
export default function BridgeViewer() {
  const [session, setSession] = useState("");
  const [latest, setLatest] = useState<Latest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSession(location.hash.slice(1)), []);

  useEffect(() => {
    if (!/^[0-9a-f]{32}$/.test(session)) return;
    let stop = false;
    const load = async () => {
      try {
        const response = await fetch(`/api/dev/extension/session/${session}/latest`, { cache: "no-store" });
        const body = (await response.json()) as Latest & { error?: string };
        if (stop) return;
        if (response.ok) {
          setLatest(body);
          setError(null);
        } else setError(body.error ?? `HTTP ${response.status}`);
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const id = setInterval(() => void load(), 3000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [session]);

  const s = latest?.snapshot;
  return (
    <div className={`wrap ${styles.page}`}>
      <div className={`night ${styles.sheet}`}>
        <span className={`eyebrow ${styles.eyebrow}`}>Dev bridge · sanitized snapshots · expires in 30 min</span>
        <h1 className={`display ${styles.h1}`}>What the extension sees</h1>
        <div className={styles.row}>
          <input
            className={styles.paste}
            style={{ maxWidth: 380 }}
            placeholder="session id (popup → Debug → Dev bridge)"
            value={session}
            spellCheck={false}
            onChange={(e) => {
              setSession(e.target.value.trim());
              history.replaceState(null, "", `#${e.target.value.trim()}`);
            }}
          />
        </div>
        {error && <p className={`${styles.status} ${styles.err}`}>{error}</p>}
        {s && (
          <>
            <div className={styles.card}>
              <div className="kv"><span>Page context</span><strong>{s.context}</strong></div>
              {s.searchResults && (
                <div className="kv"><span>Visible results</span><strong>{s.searchResults.visibleCount}</strong></div>
              )}
              <div className="kv"><span>Captured</span><span>{new Date(s.capturedAt).toLocaleTimeString()} · received {new Date(s.receivedAt).toLocaleTimeString()}</span></div>
              <div className="kv"><span>Snapshots in session</span><span>{latest!.count}</span></div>
              <div className="kv small"><span>Route</span><span>{s.diagnostics.path} · {s.diagnostics.navigationType ?? "?"} · extension v{s.diagnostics.extensionVersion}</span></div>
              <p className="small muted">Signals: {s.detection.signals.join(" · ")}</p>
            </div>
            <details className={styles.details}>
              <summary>Extracted</summary>
              <pre className={styles.pre}>{JSON.stringify(s.extracted, null, 2)}</pre>
            </details>
            <details className={styles.details}>
              <summary>Sanitized structure ({s.sanitizedStructure.length} chars)</summary>
              <pre className={styles.pre}>{s.sanitizedStructure.slice(0, 20000)}</pre>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
