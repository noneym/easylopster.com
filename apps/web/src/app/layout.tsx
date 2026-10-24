import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// Brand type from the "claw bubble" sheet: Bricolage Grotesque for everything, JetBrains Mono for code and eyebrows.
const sans = Bricolage_Grotesque({ subsets: ["latin", "latin-ext"], axes: ["opsz"], variable: "--font-sans-var", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-mono-var", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "easylopster", template: "%s · easylopster" },
  description:
    "A hosted AI assistant that lives in your Telegram. Bring your own API key, connect MCP servers and your own machine. Nothing to install.",
  openGraph: {
    type: "website",
    siteName: "easylopster",
    title: "easylopster",
    description: "A hosted AI assistant that lives in your Telegram. Bring your own API key. Nothing to install.",
  },
  icons: { icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/icon.png", type: "image/png", sizes: "512x512" }], apple: "/apple-icon.png" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F3F0" },
    { media: "(prefers-color-scheme: dark)", color: "#111214" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** Applies .dark before first paint from the stored preference or the OS setting. */
const themeScript = `(function(){try{var t=localStorage.getItem("el-theme");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark")}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-[100dvh] antialiased">
        <Script id="el-theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        {children}
      </body>
    </html>
  );
}
