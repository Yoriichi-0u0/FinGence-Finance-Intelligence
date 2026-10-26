import { describe, expect, it } from "vitest";
import { extractDocument } from "../../lib/ai-ingestion/extract";
import { bindReusableBlueprint, createReusableBlueprint } from "../../lib/ai-ingestion/reuse";
import { recordedFixtureProposal } from "./recorded-fixture-proposal";
import { verifyAndExecute } from "../../lib/ai-ingestion/verify";
const header = "Txn No,Txn Date,Posting Date,Amount,CCY,Details\n";
describe("Reusable blueprint with fresh evidence binding, not reused source IDs", () => {
  it("rebinds new values and reruns verification on an unseen file instance", async () => {
    const a = await extractDocument(Buffer.from(header + "000001,2026-09-01,2026-09-03,10.50,MYR,Old\n"), "a.csv");
    const b = await extractDocument(Buffer.from(header + "000009,2026-10-01,2026-10-03,-99.05,USD,New\n"), "b.csv");
    const template = createReusableBlueprint(a, recordedFixtureProposal(a), "RECORDED_TEST");
    const rebound = bindReusableBlueprint(template, b);
    const result = verifyAndExecute(b, rebound);
    expect(result.accepted[0].financial).toMatchObject({ source_amount: "-99.05", source_transaction_id: "000009", currency: "USD" });
    expect(result.accepted[0].evidenceIds.every(id => id.startsWith(b.sourceId))).toBe(true);
    expect(JSON.stringify(template)).not.toContain(a.sourceId);
    expect(template.origin).toBe("RECORDED_TEST");
  });
  it("blocks template reuse when columns change or a proposal was not verified", async () => {
    const a = await extractDocument(Buffer.from(header + "000001,2026-09-01,2026-09-03,10.50,MYR,Old\n"), "a.csv");
    const p = recordedFixtureProposal(a); p.assumptions.push("Guess policy");
    expect(() => createReusableBlueprint(a, p, "RECORDED_TEST")).toThrow();
    const template = createReusableBlueprint(a, recordedFixtureProposal(a), "RECORDED_TEST");
    const b = await extractDocument(Buffer.from(header.replace("Amount", "Other") + "000001,2026-09-01,2026-09-03,10.50,MYR,Old\n"), "b.csv");
    expect(() => bindReusableBlueprint(template, b)).toThrow();
  });
});
