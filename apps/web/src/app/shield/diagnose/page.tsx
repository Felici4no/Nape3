import type { Metadata } from "next";
import { ShieldDiagnoseScreenLoader } from "@/components/money/loaders";

export const metadata: Metadata = { title: "Shield diagnosis", robots: { index: false } };

export default function ShieldDiagnosePage() {
  return <ShieldDiagnoseScreenLoader />;
}
