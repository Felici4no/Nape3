"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import styles from "./vault.module.css";

export interface GraphProps {
  nodes: Array<{ slug: string; group: string; x: number; y: number; title: string }>;
  edges: Array<[string, string, "link" | "folder"]>;
  /** The note being read: drawn in the accent color, with its neighbours lit. */
  current?: string;
  /** Height as a fraction of the width (the SVG scales to its container's width). */
  aspect?: number;
  labels?: "all" | "hover";
  /** Drawing width in SVG units: smaller means bigger nodes and labels on screen. */
  width?: number;
}

/** Folder colors, the way a vault colors groups in its graph view. */
const GROUP_COLOR: Record<string, string> = {
  // the site's food tones (globals.css): night ink, burger, pizza, açaí, sushi, cheaper/pricier
  "": "#f3ede1",
  "00-overview": "#f3ede1",
  "01-problem": "#d7322b",
  "02-user": "#d7322b",
  "03-market": "#f28c6b",
  "04-product": "#f2b705",
  "05-architecture": "#c9a6e8",
  "06-business": "#7bd389",
  "07-hackathon": "#d9412b",
  "08-proofs": "#7bd389",
  decisions: "#f6c445",
  incidents: "#ff8a7a",
  spikes: "#b9ad9b",
  apps: "#8c8170"
};

/**
 * SVG graph of the vault. Positions are precomputed at build time
 * (scripts/docs-lib.mjs, layoutGraph); here we only draw, hover and navigate.
 */
export function Graph({ nodes, edges, current, aspect = 0.5, labels = "hover", width = 1000 }: GraphProps) {
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const W = width;
  const H = Math.round(width * aspect);
  const pad = width < 600 ? 34 : 46;

  const degree = useMemo(() => {
    const m = new Map<string, number>();
    for (const [a, b] of edges) {
      m.set(a, (m.get(a) ?? 0) + 1);
      m.set(b, (m.get(b) ?? 0) + 1);
    }
    return m;
  }, [edges]);

  // fit the given nodes to the box with one scale (the local graph passes a subset), centered
  const pos = useMemo(() => {
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const sx = x1 > x0 ? (W - pad * 2) / (x1 - x0) : Infinity;
    const sy = y1 > y0 ? (H - pad * 2) / (y1 - y0) : Infinity;
    const scale = Math.min(sx, sy);
    const k = Number.isFinite(scale) ? scale : 0;
    const ox = (W - (x1 - x0) * k) / 2;
    const oy = (H - (y1 - y0) * k) / 2;
    return new Map(nodes.map((n) => [n.slug, { x: ox + (n.x - x0) * k, y: oy + (n.y - y0) * k }]));
  }, [nodes, H, W, pad]);

  const focus = hover ?? current ?? null;
  const lit = useMemo(() => {
    if (!focus) return null;
    const s = new Set([focus]);
    for (const [a, b] of edges) {
      if (a === focus) s.add(b);
      if (b === focus) s.add(a);
    }
    return s;
  }, [focus, edges]);

  const visibleEdges = edges.filter(([a, b]) => pos.has(a) && pos.has(b));
  return (
    <svg className={styles.graph} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Graph of linked notes">
      <g>
        {visibleEdges.map(([a, b, kind]) => {
          const p = pos.get(a)!;
          const q = pos.get(b)!;
          const on = lit ? lit.has(a) && lit.has(b) && (a === focus || b === focus) : false;
          return (
            <line
              key={`${a}|${b}`}
              x1={p.x}
              y1={p.y}
              x2={q.x}
              y2={q.y}
              className={`${styles.edge} ${kind === "folder" ? styles.edgeFolder : ""} ${on ? styles.edgeOn : ""} ${lit && !on ? styles.dim : ""}`}
            />
          );
        })}
      </g>
      <g>
        {nodes.map((n) => {
          const p = pos.get(n.slug)!;
          const r = (5 + Math.min(9, (degree.get(n.slug) ?? 0) * 1.4)) * (width < 600 ? 0.8 : 1);
          const isCurrent = n.slug === current;
          const faded = lit && !lit.has(n.slug);
          const showLabel = labels === "all" || n.slug === focus || isCurrent || (hover !== null && (lit?.has(n.slug) ?? false));
          return (
            <g
              key={n.slug}
              className={`${styles.node} ${faded ? styles.dim : ""}`}
              transform={`translate(${p.x} ${p.y})`}
              onMouseEnter={() => setHover(n.slug)}
              onMouseLeave={() => setHover(null)}
              onClick={() => router.push(`/docs/${n.slug}`)}
              tabIndex={0}
              role="link"
              aria-label={n.title}
              onKeyDown={(e) => e.key === "Enter" && router.push(`/docs/${n.slug}`)}
            >
              <circle r={r + 10} className={styles.hit} />
              <circle r={r} fill={isCurrent ? "var(--v-accent)" : GROUP_COLOR[n.group] ?? "#999"} className={isCurrent ? styles.nodeCurrent : undefined} />
              {showLabel && (
                <text y={r + (width < 600 ? 13 : 20)} className={styles.nodeLabel} style={width < 600 ? { fontSize: 10.5, strokeWidth: 3.5 } : undefined}>
                  {n.title.length > (width < 600 ? 24 : 34) ? `${n.title.slice(0, width < 600 ? 22 : 32)}…` : n.title}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
