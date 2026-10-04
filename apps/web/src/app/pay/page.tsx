import type { Metadata } from "next";
import { PayScreenLoader } from "@/components/money/loaders";

export const metadata: Metadata = { title: "Pay" };

export default function PayPage() {
  return <PayScreenLoader />;
}
