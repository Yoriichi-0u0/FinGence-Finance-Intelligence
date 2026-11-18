import { beforeAll, describe, expect, it } from "vitest";
import { analyzeAcceptedDataPayload } from "../../lib/analytics/accepted-data-adapter";
import {
  FINANCIAL_EXPLANATION_PROMPT_VERSION,
  createLocalManagementReport,
  type LocalManagementReport,
} from "../../lib/ai-reporting";
import {
  LOCAL_REPORT_STORAGE_KIND,
  LOCAL_REPORT_STORAGE_VERSION,
  LocalReportRepositoryError,
  createLocalReportRepository,
  isRegisteredSyntheticReportHash,
  type LocalReportStorageDriver,
  type SavedLocalReport,
} from "../../lib/ai-reporting/local-report-repository";
import { createAcceptedDataPayload, type IngestionResult } from "../../lib/ingestion";
import { consultationResults } from "../integration/fixtures";

class MemoryReportDriver implements LocalReportStorageDriver {
  readonly values = new Map<string, unknown>();

  async readAll(): Promise<readonly unknown[]> {
    return [...this.values.values()].map(value => structuredClone(value));
  }

  async read(reportId: string): Promise<unknown | undefined> {
    const value = this.values.get(reportId);
    return value === undefined ? undefined : structuredClone(value);
  }

  async write(value: SavedLocalReport): Promise<void> {
    this.values.set(value.reportId, structuredClone(value));
  }

  async remove(reportId: string): Promise<void> {
    this.values.delete(reportId);
  }
}

let results: IngestionResult[];

beforeAll(async () => {
  results = await consultationResults();
});

async function makeReport(generatedAt: string, filename = "ledger.csv"): Promise<LocalManagementReport> {
  const result = results.find(candidate => candidate.dataset.file.name === filename);
  if (!result) throw new Error(`Missing synthetic fixture ${filename}.`);
  const payload = createAcceptedDataPayload([result]);
  const analysis = analyzeAcceptedDataPayload(payload, "include");
  return createLocalManagementReport({
    payload,
    analysis,
    warningPolicy: "include",
    organizationName: "Synthetic Test Workspace",
    generatedAt,
  });
}

function fakeValidatedExplanation(report: LocalManagementReport) {
  const metric = report.metrics[0];
  return {
    version: "financial-explanation-result-0.1" as const,
    status: "AI_DRAFT_REQUIRES_REVIEW" as const,
    managementSummary: "The checked source values are presented with their required review boundaries.",
    claims: [{ topic: "SOURCE_VALUE_TOTAL" as const, claim: metric.claim }],
    limitationCodes: [
      "SOURCE_VALUES_NOT_FINANCIAL_STATEMENT_METRICS" as const,
      "HUMAN_REVIEW_REQUIRED" as const,
    ],
    references: [{ evidenceId: metric.evidenceId, label: metric.label }],
    bundleExceptions: report.policyExceptions.map(exception => ({
      code: exception.code,
      severity: exception.severity,
      blocksPublication: exception.blocksPublication,
    })),
    validation: {
      assurance: "STRUCTURAL_ONLY" as const,
      status: "PASSED" as const,
      semanticReviewRequired: true as const,
      publicationAuthorized: false as const,
    },
    generation: {
      provider: "TEST" as const,
      actualModelRequest: false,
      modelIdentifier: "synthetic-test-model",
      requestId: null,
      inputTokens: null,
      outputTokens: null,
      generatedAt: "2026-10-29T12:06:00.000Z",
      promptVersion: FINANCIAL_EXPLANATION_PROMPT_VERSION,
    },
  };
}

describe("local synthetic report repository", () => {
  it("saves immutable report snapshots, restores exact figures, and avoids refresh duplicates", async () => {
    const driver = new MemoryReportDriver();
    const repository = createLocalReportRepository(driver, () => new Date("2026-10-29T12:10:00.000Z"));
    const report = await makeReport("2026-10-29T12:05:00.000Z");

    const first = await repository.saveReport(report);
    const second = await repository.saveReport(structuredClone(report));
    const restored = await repository.listReports();

    expect(first.reportId).toBe(report.reportId);
    expect(second.savedAt).toBe(first.savedAt);
    expect(driver.values.size).toBe(1);
    expect(restored.issues).toEqual([]);
    expect(restored.reports).toHaveLength(1);
    expect(restored.reports[0].storageKind).toBe("BROWSER_INDEXED_DB_SYNTHETIC_ONLY");
    expect(restored.reports[0].report.metrics.map(metric => metric.exactValue)).toEqual(["2129.4", "403.55"]);
  });

  it("keeps separate dataset snapshots separate and deletes only the selected report", async () => {
    const driver = new MemoryReportDriver();
    const repository = createLocalReportRepository(driver, () => new Date("2026-10-29T12:10:00.000Z"));
    const ledger = await makeReport("2026-10-29T12:05:00.000Z", "ledger.csv");
    const bank = await makeReport("2026-10-29T12:06:00.000Z", "bank_statement.xlsx");

    await repository.saveReport(ledger);
    await repository.saveReport(bank);
    expect((await repository.listReports()).reports.map(entry => entry.report.dataset.sourceFile).sort()).toEqual([
      "bank_statement.xlsx",
      "ledger.csv",
    ]);

    await repository.deleteReport(ledger.reportId);
    const remaining = await repository.listReports();
    expect(remaining.reports).toHaveLength(1);
    expect(remaining.reports[0].report.dataset.datasetId).toBe(bank.dataset.datasetId);
    expect(remaining.reports[0].report.metrics[0].exactValue).toBe("2345.75");

    await repository.deleteReport(bank.reportId);
    expect((await repository.listReports()).reports).toEqual([]);
  });

  it("preserves a validated synthetic AI explanation without silently regenerating it", async () => {
    const driver = new MemoryReportDriver();
    const repository = createLocalReportRepository(driver, () => new Date("2026-10-29T12:10:00.000Z"));
    const report = await makeReport("2026-10-29T12:05:00.000Z");
    await repository.saveReport(report);

    const updated = await repository.saveExplanation(report.reportId, fakeValidatedExplanation(report));
    const restored = await repository.listReports();

    expect(updated.aiExplanation?.generation.modelIdentifier).toBe("synthetic-test-model");
    expect(restored.reports[0].aiExplanation?.managementSummary).toContain("checked source values");
    expect(restored.reports[0].aiExplanation?.references[0].evidenceId).toBe(report.metrics[0].evidenceId);
  });

  it("rejects unregistered data and refuses to overwrite a report ID with changed contents", async () => {
    const driver = new MemoryReportDriver();
    const repository = createLocalReportRepository(driver, () => new Date("2026-10-29T12:10:00.000Z"));
    const report = await makeReport("2026-10-29T12:05:00.000Z");
    const unregistered = structuredClone(report);
    unregistered.dataset.fileSha256 = "c".repeat(64);

    await expect(repository.saveReport(unregistered)).rejects.toMatchObject({
      code: "UNREGISTERED_SYNTHETIC_REQUIRED",
    });

    await repository.saveReport(report);
    const changed = structuredClone(report);
    changed.title = "Changed after snapshot";
    await expect(repository.saveReport(changed)).rejects.toMatchObject({
      code: "IMMUTABLE_REPORT_CONFLICT",
    });
  });

  it("discards corrupt, expired, and incompatible entries without crashing the library", async () => {
    const driver = new MemoryReportDriver();
    const repository = createLocalReportRepository(driver, () => new Date("2026-10-29T12:10:00.000Z"));
    const report = await makeReport("2026-10-29T12:05:00.000Z");
    const valid = await repository.saveReport(report);
    driver.values.clear();
    driver.values.set("corrupt", { reportId: "corrupt", storageVersion: LOCAL_REPORT_STORAGE_VERSION });
    driver.values.set("old-version", { ...valid, reportId: "old-version", storageVersion: "local-synthetic-report-0" });
    driver.values.set("expired", { ...valid, reportId: "expired", report: { ...valid.report, reportId: "expired" }, expiresAt: "2026-10-28T00:00:00.000Z" });

    const restored = await repository.listReports();

    expect(restored.reports).toEqual([]);
    expect(restored.issues.map(issue => issue.code).sort()).toEqual([
      "CORRUPT_ENTRY",
      "EXPIRED_ENTRY",
      "INCOMPATIBLE_VERSION",
    ]);
    expect(driver.values.size).toBe(0);
  });

  it("drops only a corrupt saved explanation while retaining its deterministic report", async () => {
    const driver = new MemoryReportDriver();
    const repository = createLocalReportRepository(driver, () => new Date("2026-10-29T12:10:00.000Z"));
    const report = await makeReport("2026-10-29T12:05:00.000Z");
    const saved = await repository.saveReport(report);
    driver.values.set(report.reportId, { ...saved, aiExplanation: { status: "pretend-approved" } });

    const restored = await repository.listReports();

    expect(restored.reports).toHaveLength(1);
    expect(restored.reports[0].aiExplanation).toBeNull();
    expect(restored.issues).toEqual([{ code: "AI_EXPLANATION_DISCARDED", reportId: report.reportId }]);
  });

  it("reports unavailable storage through a stable repository error", async () => {
    const unavailable: LocalReportStorageDriver = {
      readAll: async () => Promise.reject(new Error("blocked")),
      read: async () => Promise.reject(new Error("blocked")),
      write: async () => Promise.reject(new Error("blocked")),
      remove: async () => Promise.reject(new Error("blocked")),
    };
    const repository = createLocalReportRepository(unavailable);
    const report = await makeReport("2026-10-29T12:05:00.000Z");

    await expect(repository.listReports()).rejects.toBeInstanceOf(LocalReportRepositoryError);
    await expect(repository.listReports()).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    await expect(repository.saveReport(report)).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  });

  it("uses explicit storage version and kind identifiers", () => {
    expect(LOCAL_REPORT_STORAGE_VERSION).toBe("local-synthetic-report-1");
    expect(LOCAL_REPORT_STORAGE_KIND).toBe("BROWSER_INDEXED_DB_SYNTHETIC_ONLY");
    expect(isRegisteredSyntheticReportHash("13c0d038845941abb8e974bc55832f0b1f157bac343c4f4ab5189ba0b0a30bfb")).toBe(true);
  });
});
