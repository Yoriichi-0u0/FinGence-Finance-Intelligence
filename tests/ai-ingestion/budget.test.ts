import { mkdtempSync, rmSync, symlinkSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BudgetLedger } from "../../lib/ai-ingestion/budget";
describe("US$5 persistent application inference ceiling", () => {
  it("reserves before dispatch, survives restart and blocks the 34th worst-case request", () => {
    const dir = mkdtempSync(join(tmpdir(), "v2-budget-"));
    try {
      const ledger = new BudgetLedger(dir);
      for (let i = 0; i < 33; i++) ledger.reserve();
      const restarted = new BudgetLedger(dir);
      expect(restarted.summary().reservedMicroUsd).toBe(4_950_000);
      expect(() => restarted.reserve()).toThrow(/budget/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("retains a timed-out request reservation and counts actual token evidence without freeing it", () => {
    const dir = mkdtempSync(join(tmpdir(), "v2-budget-"));
    try {
      const ledger = new BudgetLedger(dir); const id = ledger.reserve();
      ledger.settle(id, { inputTokens: 12000, outputTokens: 4000, requestId: "test-only" });
      ledger.reserve();
      expect(ledger.summary()).toMatchObject({ reservedMicroUsd: 300000, estimatedMicroUsd: 64000, calls: 2, pending: 1 });
      expect(() => ledger.settle(id, { inputTokens: 1, outputTokens: 1, requestId: "duplicate" })).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("rejects corrupt ledgers and a symlinked ledger directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "v2-budget-"));
    try { symlinkSync(dir, join(dir, "link")); expect(() => new BudgetLedger(join(dir, "link")).summary()).toThrow();
      writeFileSync(join(dir, "budget.json"), '{"version":1,"entries":"corrupt"}', { mode: 0o600 });
      expect(() => new BudgetLedger(dir).reserve()).toThrow();
      expect(statSync(join(dir, "budget.json")).mode & 0o777).toBe(0o600);
    }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
