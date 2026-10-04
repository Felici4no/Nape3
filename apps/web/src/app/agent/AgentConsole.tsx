"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { planPurchase, type CandidateEvaluation, type PurchasePlan } from "@nape3/agent";
import type { ProductRequirement } from "@nape3/domain";
import { marketFixtures } from "@nape3/fixtures";
import { SyntheticTag } from "@/components/bits";
import { brl, freshnessLabel } from "@/lib/format";
import styles from "./agent.module.css";

const REGION = "BR-SP-sao-paulo";

/** Runs the same deterministic agent as the extension, in the browser, over the demo market. */
function run(request: string): PurchasePlan {
  const now = new Date();
  return planPurchase(request, marketFixtures(now), { now, policy: { provenance: "include-synthetic", marketRegion: REGION } });
}

function Candidate({ c, rank }: { c: CandidateEvaluation; rank: number }) {
  return (
    <li className={styles.cand}>
      <span className={`num ${styles.rank}`}>{rank}</span>
      <span>
        <strong>{c.merchantName}</strong> <span className="muted small">· {c.source} · {freshnessLabel(c.ageMinutes)}</span>
        <span className={`small muted ${styles.formula}`}>{c.score?.formula}</span>
      </span>
      <span className="num">{brl(c.totalCents)}</span>
    </li>
  );
}

interface InstrumentRef {
  slug: string;
  intent: string;
  requirement: ProductRequirement;
}

export function AgentConsole({ initial, instruments }: { initial: string; instruments: InstrumentRef[] }) {
  const examples = instruments.map((i) => i.intent);
  const [request, setRequest] = useState(initial);
  const [plan, setPlan] = useState<PurchasePlan | null>(null);
  useEffect(() => setPlan(run(initial)), [initial]);

  const submit = (text: string) => {
    setRequest(text);
    setPlan(run(text));
  };
  const d = plan?.decision ?? null;
  const intent = plan?.intent.ok ? plan.intent.intent : null;
  const market = intent
    ? instruments.find(
        (i) =>
          i.requirement.category === intent.product.category &&
          i.requirement.volumeMl === intent.product.volumeMl &&
          i.requirement.size === intent.product.size &&
          i.requirement.pieces === intent.product.pieces
      )
    : undefined;

  return (
    <div className="wrap">
      <header className={styles.header}>
        <span className="eyebrow">Purchase intent · <SyntheticTag /></span>
        <h1 className={`display ${styles.h1}`}>Tell the agent what you want.</h1>
      </header>

      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          submit(request);
        }}
      >
        <input className="field" value={request} onChange={(e) => setRequest(e.target.value)} aria-label="Purchase intent" maxLength={200} />
        <button className="btn" type="submit">Decide</button>
      </form>
      <div className={styles.examples}>
        {examples.map((ex) => (
          <button key={ex} type="button" className="tag" onClick={() => submit(ex)}>{ex}</button>
        ))}
      </div>

      {plan && !plan.intent.ok && <p className={`warn ${styles.error}`}>Not understood: {plan.intent.reason}</p>}

      {plan && intent && d && (
        <div className={styles.result}>
          <section className={`paper ${styles.parsed}`}>
            <span className="eyebrow">Understood as</span>
            <ul>
              <li><strong>{intent.product.quantity}× {intent.product.category}</strong>
                {intent.product.volumeMl ? ` ${intent.product.volumeMl} ml` : ""}{intent.product.size ? ` ${intent.product.size}` : ""}{intent.product.pieces ? ` ${intent.product.pieces} peças` : ""}</li>
              <li>max {intent.budget.maxCents !== undefined ? brl(intent.budget.maxCents) : "not stated"}</li>
              <li>weights: price {intent.preferences.priceWeight} · ETA {intent.preferences.etaWeight}</li>
              {intent.parsing.missing.map((m) => <li key={m} className="warn">missing: {m}</li>)}
            </ul>
            <p className="small muted">Agent state: <span className="num">{plan.agent.state}</span></p>
          </section>

          {d.status === "selected" ? (
            <section className={`night ${styles.pick}`}>
              <span className="eyebrow">Lowest valid option</span>
              <div className={styles.pickTotal}>
                <span className="num">{brl(d.totalCents)}</span>
                <span>{d.selected!.merchantName}<span className={styles.src}>{d.selected!.source}</span></span>
              </div>
              <div className={styles.facts}>
                <div><span className="eyebrow">vs median</span><span className="num cheaper">{brl(d.savings.vsMarketMedianCents)}</span><span className="small">median {brl(d.marketMedianCents)}</span></div>
                <div><span className="eyebrow">confidence</span><span className="num">{d.confidence}</span><span className="small">{d.containsSynthetic ? "synthetic data halves it" : "observation-based"}</span></div>
                <div><span className="eyebrow">freshness</span><span className="num">{freshnessLabel(d.freshness.selectedAgeMinutes)}</span><span className="small">newest {freshnessLabel(d.freshness.newestAgeMinutes)}</span></div>
              </div>
              <p className={styles.exec}>{d.selected!.executability.note}</p>
              {market && (
                <div className={styles.actions}>
                  <Link className="btn light" href={`/market/${market.slug}`}>See the market</Link>
                </div>
              )}
            </section>
          ) : (
            <section className={`night ${styles.pick}`}>
              <span className="eyebrow">No valid option</span>
              <p className={`display ${styles.none}`}>Nothing recommended.</p>
              <p className="small">Every candidate failed a hard constraint. See why below.</p>
            </section>
          )}

          <section className={styles.lists}>
            {d.alternatives.length > 0 && (
              <div>
                <h2 className={styles.h2}>Ranked alternatives</h2>
                <ol className={styles.cands}>
                  {[d.selected!, ...d.alternatives].slice(0, 6).map((c, i) => <Candidate key={c.observationId} c={c} rank={i + 1} />)}
                </ol>
              </div>
            )}
            <details className={styles.details} open={d.status !== "selected"}>
              <summary>Rejected ({d.rejected.length}) and reasoning</summary>
              <ul className={styles.reasons}>
                {[...intent.parsing.notes.map((n) => `Parser: ${n}`), ...d.reasoning].map((line, i) => <li key={i}>{line}</li>)}
              </ul>
            </details>
          </section>
        </div>
      )}
    </div>
  );
}
