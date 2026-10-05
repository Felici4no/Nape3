import type { Metadata, Viewport } from "next";
import "@fontsource/anton";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./globals.css";
import { DataBanner, Footer, TopBar } from "@/components/Shell";
import { BottomNav } from "@/components/nav/BottomNav";
import { Splash, SPLASH_BOOT } from "@/components/nav/Splash";

export const metadata: Metadata = {
  title: { default: "UPAY3FOOD: the food market", template: "%s · UPAY3FOOD" },
  description: "Find the lowest valid way to complete the purchase. Observed food prices, an explainable agent and private payment."
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f3ede1" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SPLASH_BOOT }} />
        <noscript>
          <style>{".splash{display:none}"}</style>
        </noscript>
      </head>
      <body>
        <Splash />
        <TopBar />
        <DataBanner />
        <main>{children}</main>
        <Footer />
        <BottomNav />
      </body>
    </html>
  );
}
