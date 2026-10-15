import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assertPhase2DatabaseTarget } from "../../lib/server/cli/database-target";
const reference = "abcdefghijklmnopqrst";
const target = { host: `db.${reference}.supabase.co`, port: 5432, user: "postgres", database: "postgres", ssl: { rejectUnauthorized: true } };
const approval = { FINSIGHT_PHASE2_ALLOW_HOSTED_FYP_A: "YES", FINSIGHT_PHASE2_FYP_A_PROJECT_REF: reference };
it("allows loopback without hosted consent", () => {
  expect(() => assertPhase2DatabaseTarget({ host: "127.0.0.1" }, {})).not.toThrow();
});
it("blocks hosted targets by default", () => {
  expect(() => assertPhase2DatabaseTarget(target, {})).toThrow();
});
it("permits only an explicitly authorized project-bound Direct target", () => {
  expect(() => assertPhase2DatabaseTarget(target, approval)).not.toThrow();
});
it.each([
  { ...target, host: "db.aaaaaaaaaaaaaaaaaaaa.supabase.co" },
  { ...target, host: "example.invalid" },
  { ...target, port: 6543 },
  { ...target, database: "other" },
  { ...target, user: "other" },
  { ...target, ssl: false },
  { ...target, ssl: { rejectUnauthorized: false } },
])("rejects mismatched or unsafe remote settings %#", config => {
  expect(() => assertPhase2DatabaseTarget(config, approval)).toThrow();
});
it.each(["NO", "yes", undefined])("requires exact explicit consent %#", consent => {
  expect(() => assertPhase2DatabaseTarget(target, { ...approval, FINSIGHT_PHASE2_ALLOW_HOSTED_FYP_A: consent })).toThrow();
});
