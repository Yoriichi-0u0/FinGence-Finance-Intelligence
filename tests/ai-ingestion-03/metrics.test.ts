import { describe, expect, it } from "vitest";
import { bankEvidence } from "./helpers";
import { scoreExtraction, scoreAccepted } from "../../lib/ai-ingestion/increment-03/metrics";
describe("Independent evaluation denominators and identity matching", () => {
  it("matches source cells by row identity and named column, including missing blanks", async () => {
    const b = await bankEvidence();
    const truth = { headers: ["Transaction Code", "Amount", "Reference"], rows: [["00000001234", "9007199254740993.01", "000001"], ["not-present", "1.00", ""]] };
    expect(scoreExtraction(b, truth)).toEqual({ exactFields: 3, expectedFields: 6, exactRows: 1, expectedRows: 2 });
  });
  it("does not count duplicate accepted outputs or wrong monetary/date values as correct", () => {
    const expected = [{ source_transaction_id: "0001", source_amount: "10", posting_date: "2026-10-25" }];
    expect(scoreAccepted([{ financial: expected[0] }, { financial: expected[0] }], expected)).toEqual({ exactAccepted: 1, falseAccepted: 1, eligibleWithheld: 0 });
    expect(scoreAccepted([{ financial: { ...expected[0], source_amount: "100" } }], expected)).toEqual({ exactAccepted: 0, falseAccepted: 1, eligibleWithheld: 1 });
  });
});

describe("Manual quota-resume without automatic inference retry", () => {
  it("skips confirmed responses, keeps undispatched admissions and refuses unknown outcomes", async () => {
    const { pendingCases } = await import("../../lib/ai-ingestion/increment-03/metrics");
    const manifest = { a: { sha256: "a" }, b: { sha256: "b" } };
    const rows = [{ file: "a", sha256: "a", mode: "LIVE_GROQ", inference: {} }, { file: "b", sha256: "b", mode: "NOT_EXECUTED", inference: null }];
    expect(pendingCases(manifest, rows)).toEqual(["b"]);
    expect(() => pendingCases(manifest, [{ ...rows[1], mode: "DISPATCHED_UNKNOWN" }])).toThrow(/UNKNOWN/);
    expect(() => pendingCases(manifest, [{ ...rows[0], sha256: "changed" }])).toThrow(/SOURCE/);
  });
});

it("rejects incomplete resume arguments and changed fixture bytes before processing", async () => {
  const { resumeArgument, assertSourceDigest } = await import("../../lib/ai-ingestion/increment-03/metrics");
  expect(() => resumeArgument(["--live", "--resume"])).toThrow(/RESUME_PATH/);
  expect(() => resumeArgument(["--resume", "--regression"])).toThrow(/RESUME_PATH/);
  expect(resumeArgument(["--resume", "previous.json"])).toBe("previous.json");
  expect(() => assertSourceDigest(Buffer.from("changed"), "0".repeat(64))).toThrow(/SOURCE/);
});
