import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const incoming = vi.hoisted(() => ({ host: "127.0.0.1:3194", site: "same-origin" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/financial-m3/selection", () => import("../../lib/financial-m3/selection"));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: incoming.host, "sec-fetch-site": incoming.site }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("../../app/illustrative", () => ({ default: () => null }));
import OverviewPage from "../../app/page";
import PocFinancialPreview from "../../components/poc-financial-preview";
import IllustrativeOverview from "../../app/illustrative";

const flags = ["FINGENCE_AI_LOCAL", "FINGENCE_V2_I1_LOCAL", "FINGENCE_M2_LOCAL", "FINGENCE_M3_LOCAL", "FINGENCE_M4_LOCAL", "FINGENCE_M5_LOCAL", "FINGENCE_POC_LOCAL"];
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL", undefined);
  for (const flag of flags) vi.stubEnv(flag, "1");
  incoming.host = "127.0.0.1:3194";
  incoming.site = "same-origin";
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Overview server boundary", () => {
  it("shows a source-free local guide with guarded existing destinations", async () => {
    const html = renderToStaticMarkup(await OverviewPage());
    expect(html).toContain("Synthetic Financial Intelligence Proof of Concept");
    for (const href of ["/transactions", "/reconciliation", "/analytics", "/anomalies", "/forecasting", "/reports", "/admin", "/ai-ingestion"]) expect(html).toContain(`href="${href}"`);
    for (const misleading of ["Key financial metrics", "Reconciliation Rate", "96.8%", "Accuracy 92.4%", "248,420"]) expect(html).not.toContain(misleading);
    expect(html).not.toContain("About This Demonstration");
    expect(html).toContain("not live E5 machine learning");
    expect(html).toContain("Admin access required");
  });
  it.each(flags)("retains the original component when %s is off", async flag => {
    vi.stubEnv(flag, "0");
    expect((await OverviewPage()).type).toBe(IllustrativeOverview);
  });
  it.each(["production", "test"])("cannot enable local content in NODE_ENV=%s", async mode => {
    vi.stubEnv("NODE_ENV", mode);
    expect((await OverviewPage()).type).toBe(IllustrativeOverview);
  });
  it("retains the original on hosted Vercel even with every local flag set", async () => {
    vi.stubEnv("VERCEL", "1");
    expect((await OverviewPage()).type).toBe(IllustrativeOverview);
  });
  it.each(["example.com:3194", "invalid host", ""])("refuses local content for host %s", async host => {
    incoming.host = host;
    await expect(OverviewPage()).rejects.toThrow("NOT_FOUND");
  });
  it("rejects cross-site requests even with a loopback host", async () => {
    incoming.site = "cross-site";
    await expect(OverviewPage()).rejects.toThrow("NOT_FOUND");
  });
});

it("replaces capability links with financial previews and one shared no-source explanation",()=>{
 const html=renderToStaticMarkup(React.createElement(PocFinancialPreview,{data:null,analysis:null,message:"No synthetic financial source has been uploaded yet."}));
 for(const title of ["Money Received","Money Paid Out","Net Cash Movement","Reconciliation Results","Recent Anomalies"])expect(html).toContain(title);
 for(const title of ["Check Uploaded Records","Compare Transactions","Explore Financial Trends","View Financial Reports"])expect(html).not.toContain(title);
 for(const path of ["/analytics","/reconciliation","/anomalies"])expect(html).toContain(`href="${path}"`);
 expect(html.match(/No synthetic financial source has been uploaded yet/g)).toHaveLength(1);
 expect(html).not.toContain("Unavailable");expect(html).not.toContain("%");expect(html).not.toContain("MYR");
});
it("shows plain language explanations and technical boundaries",async()=>{
 const html=renderToStaticMarkup(await OverviewPage());
 for(const text of ["How FinGence Works","Upload and Check Records","Compare Bank and Accounting Records","Understand Financial Information","not live E5 machine learning"])expect(html).toContain(text);
});
