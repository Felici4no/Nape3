"use client";

import dynamic from "next/dynamic";

// Wallet + Cloak code only ever runs in the browser.
const loading = () => <div className="wrap" style={{ padding: "60px 0" }}>Loading wallet…</div>;
export const WalletScreenLoader = dynamic(() => import("./WalletScreen"), { ssr: false, loading });
export const PayScreenLoader = dynamic(() => import("./PayScreen"), { ssr: false, loading });
