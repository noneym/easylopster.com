import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

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
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1917" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** Applies .dark before first paint from the stored preference or the OS setting. */
const themeScript = `(function(){try{var t=localStorage.getItem("el-theme");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark")}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-[100dvh] antialiased">{children}</body>
    </html>
  );
}
