import type { Metadata } from "next";
import { BridgeViewerLoader } from "@/components/money/loaders";

export const metadata: Metadata = { title: "Dev bridge", robots: { index: false } };

export default function DevBridgePage() {
  return <BridgeViewerLoader />;
}
