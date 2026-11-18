import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDemoDocumentReport,
} from "../../lib/ai-reporting/demo-document-report";
import { processDocuments, type DocumentInput } from "../../lib/demo/pipeline";

const generatedAt = "2026-11-13T08:00:00.000Z";

function document(path: string): DocumentInput {
  return {
    name: path.split("/").at(-1)!,
    bytes: new Uint8Array(readFileSync(join("public/demo", path))),
    provenance: "PUBLIC_SYNTHETIC_SAMPLE",
  };
}

describe("Data document to AI Reporting bridge", () => {
  it("independently re-ingests the monthly Data sample and produces a C1 transaction review", async () => {
    const inputs = [
      document("demo-bank-statement-2026-03.csv"),
      document("demo-general-ledger-2026-03.csv"),
    ];
    const context = await processDocuments(inputs);
    const generated = await createDemoDocumentReport({ context, inputs, generatedAt });

    expect(generated.report).toMatchObject({
      reportType: "TRANSACTION_REVIEW",
      organizationName: "Rimba Demo Kitchen (Synthetic)",
      generatedAt,
      dataset: {
        sourceFile: "demo-bank-statement-2026-03.csv",
        fileSha256: context.outputs.bank!.sha256,
      },
    });
    expect(generated.verification).toMatchObject({
      method: "INDEPENDENT_C1_REINGESTION",
      acceptedRows: context.outputs.bank!.rows.length,
      comparedRows: context.outputs.bank!.rows.length,
      sourceSha256: context.outputs.bank!.sha256,
    });
    expect(generated.report.evidenceBundle.quality.rejectedCount).toBe(0);
  });

  it("produces the quarterly report for the full-quarter Data sample with matching exact totals", async () => {
    const inputs = [
      document("quarter/demo-bank-statement-2026-q1-sgd.csv"),
      document("quarter/demo-general-ledger-2026-q1-sgd.csv"),
      document("quarter/demo-bank-history-2025-04-to-2026-03-sgd.csv"),
    ];
    const context = await processDocuments(inputs);
    const generated = await createDemoDocumentReport({ context, inputs, generatedAt });
    const activity = generated.report.quarterlyActivity;

    expect(generated.report).toMatchObject({
      reportType: "QUARTERLY_FINANCIAL_ACTIVITY",
      organizationName: "Straits Demo Bakery (Synthetic)",
      generatedAt,
      dataset: {
        sourceFile: "demo-bank-statement-2026-q1-sgd.csv",
        fileSha256: context.outputs.bank!.sha256,
      },
    });
    expect(activity?.business).toMatchObject({
      identifier: "DEMO-002",
      displayName: "Straits Demo Bakery (Synthetic)",
      nameBasis: "REGISTERED_SYNTHETIC",
    });
    expect(activity?.current).toMatchObject({
      period: { key: "2026-Q1" },
      bankCredits: context.outputs.totals!.credits,
      bankDebits: context.outputs.totals!.debits.replace(/^-/, ""),
      includedTransactionCount: context.outputs.bank!.rows.length,
      monetaryBasis: "source_amount_with_direction",
    });
    expect(activity?.months.map(month => month.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("fails closed when the supplied original bytes no longer match the Data processing", async () => {
    const originals = [
      document("demo-bank-statement-2026-03.csv"),
      document("demo-general-ledger-2026-03.csv"),
    ];
    const context = await processDocuments(originals);
    const changed = originals.map((input, index) => index ? input : {
      ...input,
      bytes: new Uint8Array([...input.bytes, 10]),
    });

    await expect(createDemoDocumentReport({ context, inputs: changed, generatedAt }))
      .rejects.toMatchObject({
        code: "SOURCE_FINGERPRINT_MISMATCH",
      });
  });
});
