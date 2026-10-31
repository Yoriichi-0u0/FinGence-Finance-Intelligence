import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";
import {m3LocalEnabled} from "@/lib/server/financial-m3/runtime";
import {m5LocalEnabled} from "@/lib/server/tenant-admin-m5/flags";
import {pocLocalEnabled} from "@/lib/server/poc-reconciliation/runtime";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
    >
      <body className="min-h-full">
        <AppShell localFinancialConsumers={m3LocalEnabled()} localAdministration={m5LocalEnabled()} localReconciliation={pocLocalEnabled()}>{children}</AppShell>
      </body>
    </html>
  );
}
