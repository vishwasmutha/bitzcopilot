import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "BizCopilot — Your Business. Your Data. Your AI Copilot.",
    template: "%s · BizCopilot",
  },
  description:
    "AI-powered business intelligence for small businesses. Understand performance, predict sales, optimise inventory and generate marketing — from your own data.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

const themeScript = `(function(){try{if(localStorage.getItem('bc-theme')==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="bg-white font-sans text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">{children}</body>
    </html>
  );
}
