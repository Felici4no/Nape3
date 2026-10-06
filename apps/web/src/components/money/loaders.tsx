"use client";

import dynamic from "next/dynamic";

// Wallet + Cloak code only ever runs in the browser.
const loading = () => <div className="wrap" style={{ padding: "60px 0" }}>Loading wallet…</div>;
export const WalletScreenLoader = dynamic(() => import("./WalletScreen"), { ssr: false, loading });
export const PayScreenLoader = dynamic(() => import("./PayScreen"), { ssr: false, loading });
export const ShieldScreenLoader = dynamic(() => import("./ShieldScreen"), { ssr: false, loading });
export const ShieldDiagnoseScreenLoader = dynamic(() => import("./ShieldDiagnoseScreen"), { ssr: false, loading });
export const DiagnosticsScreenLoader = dynamic(() => import("./DiagnosticsScreen"), { ssr: false, loading });
export const BridgeViewerLoader = dynamic(() => import("./BridgeViewer"), { ssr: false, loading });
