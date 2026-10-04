import type { MarketObservation, Provenance } from "./types";

/** Returns a list of violated provenance invariants (empty = valid). */
export function validateProvenance(provenance: Provenance): string[] {
  const issues: string[] = [];
  if (provenance.synthetic && provenance.live) issues.push("synthetic data cannot be live");
  if (provenance.method === "fixture" && !provenance.synthetic) {
    issues.push("fixture data must be marked synthetic");
  }
  if (provenance.method === "fixture" && provenance.live) issues.push("fixture data cannot be live");
  if (provenance.method === "browser-extension" && provenance.synthetic) {
    issues.push("browser-extension captures cannot be synthetic");
  }
  if (provenance.method === "manual" && provenance.live) {
    issues.push("manually entered observations are not live");
  }
  return issues;
}

export type ProvenanceClass = "live" | "manual" | "synthetic" | "partner";

export function provenanceClass(provenance: Provenance): ProvenanceClass {
  if (provenance.synthetic) return "synthetic";
  if (provenance.method === "manual") return "manual";
  if (provenance.method === "partner-api") return "partner";
  return "live";
}

export function provenanceLabel(provenance: Provenance): string {
  switch (provenanceClass(provenance)) {
    case "synthetic":
      return "synthetic fixture (not a real observation)";
    case "manual":
      return "manually recorded observation";
    case "partner":
      return "partner API";
    case "live":
      return "live browser observation";
  }
}

export function ageMinutes(observedAt: string, now: Date): number {
  const observed = Date.parse(observedAt);
  if (Number.isNaN(observed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now.getTime() - observed) / 60_000);
}

export function isSynthetic(observation: MarketObservation): boolean {
  return observation.provenance.synthetic;
}
