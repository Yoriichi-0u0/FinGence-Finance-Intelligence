import { expect, it } from "vitest";
import { validateSourceFile } from "../../lib/server/persistence/source-file";
import { preparePersistencePlan } from "../../lib/server/persistence/map";
import { syntheticResult } from "./fixtures";

it.each([undefined, null, 42, {}, "", "   ", ".", "..", "a/b.csv", "a\\b.csv", "bad\n.csv", "bad\u007f.csv", "bad\u0085.csv", "a".repeat(256)])("rejects unsafe filename %#", value => {
  expect(() => validateSourceFile(value)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
});
it.each(["financial.csv", "\u8ca1\u52d9.csv", "My financial file.csv", "a".repeat(255)])("preserves useful filename %#", value => {
  expect(validateSourceFile(value)).toBe(value);
});
it("carries one filename and rejects explicit disagreement and mixed-file attempts", async () => {
  const first = await syntheticResult(), second = await syntheticResult(undefined, {}, undefined, "other.csv");
  expect(preparePersistencePlan({ source_file: first.dataset.file.name, results: [first] }).batch.source_file).toBe(first.dataset.file.name);
  expect(() => preparePersistencePlan({ source_file: "different.csv", results: [first] })).toThrow();
  expect(() => preparePersistencePlan({ results: [first, second] })).toThrow();
});
