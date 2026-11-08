import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { extractSemanticEvidence } from "../../lib/ai-ingestion/increment-02/extract";
import { bindRecordedProposal } from "../../lib/ai-ingestion/increment-02/recorded";
import { verifySemanticBlueprint } from "../../lib/ai-ingestion/increment-02/verify";

describe("0.2 source integrity and extraction boundary", () => {
  it("preserves every registered synthetic input's exact bytes", () => {
    const folder = "public/samples/ai-ingestion-increment-02";
    const manifest = JSON.parse(readFileSync(`${folder}/manifest.json`, "utf8"));
    expect(Object.keys(manifest.files)).toHaveLength(26);
    for (const [name, item] of Object.entries(manifest.files) as [string, { sha256: string; bytes: number }][]) {
      const bytes = readFileSync(`${folder}/${name}`);
      expect(bytes.length, name).toBe(item.bytes); expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(item.sha256);
    }
  });
  it("does not discard unrepresented financial text inside a table's outer boundary", () => {
    const result = spawnSync("python3", ["tests/ai-ingestion-02/extractor-context-probe.py"], { encoding: "utf8" });
    expect(result.stderr).toBe(""); expect(result.stdout).toContain("PASS:"); expect(result.status).toBe(0);
  });
});

describe.skipIf(!existsSync(".venv-ai/bin/python"))("0.2 positive image controls using preserved Increment 01 bytes", () => {
  beforeAll(() => vi.stubEnv("FINGENCE_AI_PYTHON", ".venv-ai/bin/python"));
  afterAll(() => vi.unstubAllEnvs());
  it.each(["statement.png", "statement.jpg"])("extracts and independently verifies actual %s", async name => {
    const bytes = readFileSync(`public/samples/ai-ingestion/${name}`);
    const bundle = await extractSemanticEvidence(bytes, name);
    const result = verifySemanticBlueprint(bundle, bindRecordedProposal(bundle, "TRANSACTION_TABLE"));
    expect(bundle.sourceId).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(result.decision).toBe("VERIFIED");
    expect(result.accepted.map(r => [r.financial.source_transaction_id, r.financial.transaction_date, r.financial.posting_date, r.financial.source_amount, r.financial.currency]))
      .toEqual([["000001", "2026-09-01", "2026-09-03", "1234.5", "MYR"], ["000002", "2026-09-02", "2026-09-04", "-20.05", "MYR"]]);
    expect(bundle.items.filter(i => i.box).length).toBeGreaterThan(0);
  }, 120000);
});
