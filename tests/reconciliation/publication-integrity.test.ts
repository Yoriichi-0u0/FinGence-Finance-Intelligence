import { describe, expect, it } from "vitest";
import { artifactMatch, safePath, sha256 } from "../../scripts/ai-research/verify-publication.mjs";
describe("AI publication Git-blob integrity boundary", () => {
  it("preserves byte-exact raw evidence without a text-conversion exception", () => {
    const bytes = Buffer.from('{"measurement":"1.0000000000001"}\n');
    expect(artifactMatch("any manifest", "evidence.json", bytes, sha256(bytes))).toBe("BYTE_EXACT");
    expect(() => artifactMatch("any manifest", "evidence.json", bytes, sha256(Buffer.from(bytes.toString().replace(/\n/g, "\r\n"))))).toThrow();
  });
  it("proves a known historical source capture through its full recorded SHA-256", () => {
    const bytes = Buffer.from('source\nexact financial string\n');
    expect(artifactMatch("AI05 official freeze", "package.json", bytes, sha256(Buffer.from('source\r\nexact financial string\r\n')))).toBe("CAPTURED_CRLF_SOURCE_FROM_LF_GIT_BLOB");
  });
  it("rejects changed source content even for a permitted capture path", () => {
    expect(() => artifactMatch("AI05 official freeze", "package.json", Buffer.from('changed\n'), sha256(Buffer.from('original\r\n')))).toThrow();
  });
  it("does not grant source-capture conversion to an unrelated context or evidence path", () => {
    const bytes = Buffer.from('source\n'), expected = sha256(Buffer.from('source\r\n'));
    expect(() => artifactMatch("unrelated manifest", "package.json", bytes, expected)).toThrow();
    expect(() => artifactMatch("AI05 official freeze", "predictions.json", bytes, expected)).toThrow();
  });
  it("rejects binary or mixed-line-ending substitutes", () => {
    expect(() => artifactMatch("AI05 official freeze", "package.json", Buffer.from([255,10]), sha256(Buffer.from([255,13,10])))).toThrow();
    expect(() => artifactMatch("AI05 official freeze", "package.json", Buffer.from('a\r\nb\n'), sha256(Buffer.from('a\r\nb\r\n')))).toThrow();
  });
  it("refuses paths outside the repository", () => {
    for (const path of ['../secret', '/absolute', 'C:/secret', 'a\\b', 'a/../b']) expect(() => safePath(path)).toThrow();
    expect(safePath('docs/reconciliation/evidence/result.json')).toBe('docs/reconciliation/evidence/result.json');
  });
});
