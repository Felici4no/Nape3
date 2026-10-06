import type { Metadata } from "next";
import { DiagnosticsScreenLoader } from "@/components/money/loaders";

export const metadata: Metadata = { title: "Diagnostics", robots: { index: false } };

export default function DiagnosticsPage() {
  return <DiagnosticsScreenLoader />;
}
