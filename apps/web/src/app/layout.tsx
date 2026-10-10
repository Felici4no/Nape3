import type { Metadata, Viewport } from "next";
import "@fontsource/anton";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./globals.css";
import { Footer, TopBar } from "@/components/Shell";
import { BottomNav } from "@/components/nav/BottomNav";
import { Splash, SPLASH_BOOT } from "@/components/nav/Splash";

export const metadata: Metadata = {
  title: { default: "UPAY3FOOD: você paga 3 vezes pela comida", template: "%s · UPAY3FOOD" },
  description: "A comida, as taxas e a diferença para a opção mais barata. Extensão para o iFood, servidor MCP para agentes de IA e regras registradas na Solana."
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f3ede1" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SPLASH_BOOT }} />
        <noscript>
          <style>{".splash{display:none}"}</style>
        </noscript>
      </head>
      <body>
        <Splash />
        <TopBar />
        <main>{children}</main>
        <Footer />
        <BottomNav />
      </body>
    </html>
  );
}
