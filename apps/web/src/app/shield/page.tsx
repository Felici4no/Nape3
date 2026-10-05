import type { Metadata } from "next";
import { ShieldScreenLoader } from "@/components/money/loaders";

export const metadata: Metadata = { title: "Shield" };

export default function ShieldPage() {
  return <ShieldScreenLoader />;
}
