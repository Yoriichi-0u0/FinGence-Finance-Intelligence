import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { extractDocument } from "../../lib/ai-ingestion/extract";
import { recordedFixtureProposal } from "./recorded-fixture-proposal";
import { verifyAndExecute } from "../../lib/ai-ingestion/verify";
import { execFileSync } from "node:child_process";

describe.skipIf(!existsSync(".venv-ai/bin/python"))("Actual four-format extraction; NO live AI", () => {
  beforeAll(() => vi.stubEnv("FINGENCE_AI_PYTHON", ".venv-ai/bin/python"));
  afterAll(() => vi.unstubAllEnvs());
  it.each(["statement.csv", "statement.xlsx", "statement-digital.pdf", "statement-scan.pdf", "statement-mixed.pdf", "statement.png", "statement.jpg"])("extracts exact controlled source evidence and verifies explicitly recorded proposals: %s", async name => {
    const bytes = readFileSync(`public/samples/ai-ingestion/${name}`);
    const bundle = await extractDocument(bytes, name, "docling");
    expect(bundle.sourceId).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(bundle.items.some(i => i.text === "000001")).toBe(true);
    expect(bundle.items.some(i => i.text === "-20.05")).toBe(true);
    for (const item of bundle.items) if (item.box) {
      expect(item.width).toBeGreaterThan(0); expect(item.height).toBeGreaterThan(0);
      expect(item.box[0]).toBeGreaterThanOrEqual(0); expect(item.box[1]).toBeGreaterThanOrEqual(0);
      expect(item.box[2]).toBeLessThanOrEqual(item.width!); expect(item.box[3]).toBeLessThanOrEqual(item.height!);
      expect(item.coordinateSystem).toMatch(/^TOP_LEFT_/);
    }
    if (name.endsWith("xlsx")) expect(bundle.items.find(i => i.text === "000001")?.address).toBe("A2");
    if (name.endsWith("pdf")) expect(new Set(bundle.items.map(i => i.page))).toEqual(new Set([1, 2]));
    const result = verifyAndExecute(bundle, recordedFixtureProposal(bundle));
    expect(result.decision).toBe("VERIFIED"); expect(result.accepted).toHaveLength(name.endsWith("png") || name.endsWith("jpg") ? 2 : 4);
    const truth = JSON.parse(readFileSync("tests/fixtures/ai-ingestion/ground-truth.json", "utf8"));
    const rows: string[][] = name.endsWith("png") || name.endsWith("jpg") ? truth.imageRows : truth.rows;
    expect(result.accepted.map(r => [r.financial.source_transaction_id, r.financial.transaction_date, r.financial.posting_date, r.financial.source_amount, r.financial.currency, r.financial.description]))
      .toEqual(rows.map((r, n) => [r[0], r[1], r[2], truth.normalAmounts[n], r[4], r[5]]));
  }, 120000);
  it("retains an unreadable image as unresolved evidence, not accepted data", async () => {
    const bundle = await extractDocument(readFileSync("public/samples/ai-ingestion/unreadable.png"), "unreadable.png", "docling");
    expect(verifyAndExecute(bundle, recordedFixtureProposal(bundle)).accepted).toHaveLength(0);
  }, 120000);
  it("rejects partial conversions, conversion errors and missing/duplicate pages", () => {
    execFileSync(".venv-ai/bin/python", ["tests/ai-ingestion/extractor-completeness.py"], { stdio: "pipe" });
  });
});
