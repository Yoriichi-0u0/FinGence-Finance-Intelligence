import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";
import {m3LocalEnabled} from "@/lib/server/financial-m3/runtime";
import {m5LocalEnabled} from "@/lib/server/tenant-admin-m5/flags";
import {pocLocalEnabled} from "@/lib/server/poc-reconciliation/runtime";
import {syntheticDemoEnabled} from "@/lib/server/demo/mode";
import {aiGatewayEnabled} from "@/lib/server/ai/groq-interpreter";
import {budgetStore} from "@/lib/server/ai/budget";
import {managementEnabled, processingStore} from "@/lib/server/processing/store";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5fa" },
    { media: "(prefers-color-scheme: dark)", color: "#080b1a" },
  ],
};

export const metadata: Metadata = {
  title: {
    default: "FinGence · Financial Intelligence",
    template: "%s · FinGence",
  },
  description:
    "FinGence — Finance + Intelligence. An interactive proof-of-concept for AI-assisted financial analysis and automated reporting for the Sarawak Artificial Intelligence Centre (SAIC).",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* The saved theme choice (if any) is applied before the first paint; otherwise the system setting is used. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem("fingence-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()` }} />
      </head>
      <body className="min-h-full">
        <AppShell localFinancialConsumers={m3LocalEnabled()} localAdministration={m5LocalEnabled()} localReconciliation={pocLocalEnabled()} syntheticDemo={syntheticDemoEnabled()} aiGateway={aiGatewayEnabled()} serverJobs={!!processingStore() && !!budgetStore()} management={managementEnabled()}>{children}</AppShell>
      </body>
    </html>
  );
}
