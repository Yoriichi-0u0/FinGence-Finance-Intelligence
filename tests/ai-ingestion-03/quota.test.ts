import { lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { QuotaLedger } from "../../lib/server/ai-ingestion/increment-03/quota";
const directory = () => mkdtempSync(join(tmpdir(), "fg03-quota-"));
describe("Proactive durable quota reservations", () => {
  it("reserves before dispatch, prevents concurrent requests, keeps unknown outcomes and accounts actual usage", () => {
    let now = Date.UTC(2026, 9, 25); const q = new QuotaLedger(directory(), () => now);
    const id = q.reserve(1000); expect(q.summary().attempts).toBe(1);
    expect(() => q.reserve(100)).toThrow(/IN_FLIGHT/);
    q.finish(id, "UNKNOWN"); expect(q.summary().reservedTokensToday).toBe(1000);
    const b = q.reserve(7000); q.finish(b, "COMPLETED", { inputTokens: 2000, outputTokens: 1000 });
    expect(() => q.reserve(1)).toThrow(/TPM/);
    now += 60001; expect(() => q.reserve(1)).not.toThrow();
  });
  it("enforces RPM, daily token ceiling and experiment-wide dispatch ceiling independently", () => {
    let now = Date.UTC(2026, 9, 25); const q = new QuotaLedger(directory(), () => now);
    for (let n = 0; n < 30; n++) q.finish(q.reserve(1), "FAILED");
    expect(() => q.reserve(1)).toThrow(/RPM/); now += 60001;
    for (let n = 30; n < 64; n++) { q.finish(q.reserve(1), "FAILED"); now += 60001; }
    expect(() => q.reserve(1)).toThrow(/EXPERIMENT/);
    const d = new QuotaLedger(directory(), () => now);
    for (let n = 0; n < 20; n++) { d.finish(d.reserve(8000), "UNKNOWN"); now += 60001; }
    expect(() => d.reserve(1)).toThrow(/TPD/);
  });
  it("fails closed on corrupt/symlink ledger or unbounded reservation", () => {
    const dir = directory(), q = new QuotaLedger(dir); expect(() => q.reserve(NaN)).toThrow();
    writeFileSync(join(dir, "quota.json"), "{}"); expect(() => q.reserve(1)).toThrow(/LEDGER/);
    const other = directory(); symlinkSync(join(dir, "quota.json"), join(other, "quota.json"));
    expect(() => new QuotaLedger(other).reserve(1)).toThrow(/SYMLINK/);
    expect(readFileSync(join(dir, "quota.json"), "utf8")).toBe("{}");
  });
  it.each(["ledger", "lock", "directory"] as const)("rejects a symlink %s before reading or changing its target", kind => {
    const target = directory(), container = directory();
    const original = "unchanged synthetic target";
    const targetFile = join(target, "quota.json");
    writeFileSync(targetFile, original);
    const link = kind === "directory" ? join(container, "linked")
      : join(container, kind === "ledger" ? "quota.json" : "quota.lock");
    symlinkSync(kind === "directory" ? target : targetFile, link, kind === "directory" ? "dir" : "file");
    const ledger = new QuotaLedger(kind === "directory" ? link : container);
    try {
      expect(() => ledger.summary()).toThrow("QUOTA_SYMLINK");
      expect(() => ledger.reserve(1)).toThrow("QUOTA_SYMLINK");
      expect(() => ledger.finish("unused", "FAILED")).toThrow("QUOTA_SYMLINK");
      expect(readFileSync(targetFile, "utf8")).toBe(original);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
    } finally {
      rmSync(container, { recursive: true });
      rmSync(target, { recursive: true });
    }
  });
});
