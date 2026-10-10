"use client";

import { useEffect, useState } from "react";
import styles from "./Splash.module.css";

export const SPLASH_KEY = "upay3food.splash";
/** Total time on screen before the curtain lifts (the CSS timeline below adds up to this). */
const HOLD_MS = 1650;
const LIFT_MS = 650;

/**
 * Opening screen, once per browser session. An inline script in <head>
 * (SPLASH_BOOT) marks <html> before first paint when it was already shown,
 * so it never flashes on later loads; reduced motion skips it entirely.
 */
export function Splash() {
  const [phase, setPhase] = useState<"show" | "lift" | "gone">("show");

  useEffect(() => {
    const root = document.documentElement;
    if (root.classList.contains("splash-seen")) {
      setPhase("gone");
      return;
    }
    try {
      sessionStorage.setItem(SPLASH_KEY, "1");
    } catch {
      /* storage blocked: it will simply show again next load */
    }
    root.classList.add("splash-on");
    const lift = window.setTimeout(() => setPhase("lift"), HOLD_MS);
    const done = window.setTimeout(() => {
      setPhase("gone");
      root.classList.remove("splash-on");
    }, HOLD_MS + LIFT_MS);
    return () => {
      window.clearTimeout(lift);
      window.clearTimeout(done);
      root.classList.remove("splash-on");
    };
  }, []);

  if (phase === "gone") return null;
  const letters = "UPAY3FOOD".split("");
  return (
    <div className={`splash ${styles.splash} ${phase === "lift" ? styles.lift : ""}`} aria-hidden="true">
      <div className={styles.center}>
        <div className={styles.plate}>
          <span style={{ background: "var(--burger)" }} />
          <span style={{ background: "var(--pizza)" }} />
          <span style={{ background: "var(--acai-2)" }} />
          <span style={{ background: "var(--sushi-2)" }} />
        </div>
        <p className={styles.word}>
          {letters.map((ch, i) => (
            <span key={i} className={ch === "3" ? styles.three : undefined} style={{ animationDelay: `${180 + i * 55}ms` }}>
              {ch}
            </span>
          ))}
        </p>
        <p className={styles.tag}>The real price of delivery</p>
        <div className={styles.progress}>
          <i />
        </div>
      </div>
    </div>
  );
}

/** Runs before paint: hides the splash when this session already saw it, when motion is reduced, or on the docs. */
export const SPLASH_BOOT = `try{if(/^docs\\./.test(location.hostname)||/^\\/docs(\\/|$)/.test(location.pathname)||sessionStorage.getItem("${SPLASH_KEY}")||matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.classList.add("splash-seen")}catch(e){}`;
