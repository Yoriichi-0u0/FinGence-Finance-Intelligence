import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "../../docs/integration/c3-i0-manifest.json";

const paths = [
  "public/samples/ingestion/ledger.csv",
  "public/samples/ingestion/bank_statement.xlsx",
  "public/samples/ingestion/edge_cases.csv",
  "public/samples/ingestion/expected.json",
] as const;

describe("published C3-I0 fixture byte integrity", () => {
  it.each(paths)("preserves the published size and SHA-256 of %s", path => {
    const bytes = readFileSync(new URL("../../" + path, import.meta.url));
    const expected = manifest.fixtures[path];
    expect(bytes.byteLength).toBe(expected.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected.sha256);
  });
});
