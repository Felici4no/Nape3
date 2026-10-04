import type { Metadata, Viewport } from "next";
import "@fontsource/anton";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./globals.css";
import { DataBanner, Footer, TopBar } from "@/components/Shell";

export const metadata: Metadata = {
  title: { default: "UPAY3FOOD.agent: the food market", template: "%s · UPAY3FOOD.agent" },
  description: "Find the lowest valid way to complete the purchase. Observed food prices, an explainable agent and private payment."
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f3ede1" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TopBar />
        <DataBanner />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
