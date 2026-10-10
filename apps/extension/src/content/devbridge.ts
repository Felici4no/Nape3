import type { DevSnapshotPayload, PageSnapshot } from "../shared/types";
import { capturePage, scrub } from "./capture";

/**
 * Builds the dev-bridge payload from the page: the extraction and the
 * calibration capture, both already sanitized (capture.ts). Never cookies,
 * storage, headers, input values or the raw address — the capture does not
 * read them, and the server refuses anything that still looks like PII.
 */
export function buildBridgePayload(doc: Document, snapshot: PageSnapshot, extensionVersion: string): DevSnapshotPayload {
  const view = doc.defaultView;
  const nav = view?.performance?.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
  const extracted = JSON.parse(
    scrub(JSON.stringify({ restaurant: snapshot.restaurant ?? null, product: snapshot.product ?? null, cart: snapshot.cart ?? null, pix: snapshot.pix ?? null }))
  ) as Record<string, unknown>;
  // The restaurant's public path is built from a strict pattern (merchant.ts), not page text.
  extracted.merchant = snapshot.merchant ?? null;
  return {
    schema: "upay3food.dev-snapshot.v1",
    capturedAt: snapshot.capturedAt,
    context: snapshot.detection.context,
    detection: { context: snapshot.detection.context, confidence: snapshot.detection.confidence, signals: snapshot.detection.signals },
    extracted,
    sanitizedStructure: capturePage(doc, snapshot),
    diagnostics: {
      extensionVersion,
      pageContext: snapshot.detection.context,
      navigationType: nav?.type ?? null,
      pageAgeSeconds: view?.performance ? Math.round(view.performance.now() / 1000) : null,
      path: doc.location.pathname.replace(/[0-9a-f-]{16,}/gi, "[id]")
    }
  };
}

/** One post per real change, at most every MIN_INTERVAL_MS: same route + context + similar page size = same state. */
export const MIN_INTERVAL_MS = 3_000;

export function bridgeKey(doc: Document, snapshot: PageSnapshot): string {
  const size = Math.round((doc.body?.textContent?.length ?? 0) / 500);
  return `${doc.location.pathname}|${snapshot.detection.context}|${size}`;
}
