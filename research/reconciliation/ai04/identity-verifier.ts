import type { RecordEvidence } from "./types";
import { check, text } from "./financial-verifier";
/** NFC + outer whitespace only. Case, punctuation and internal spacing remain significant. */
export const normalizeIdentity = (value: unknown): string | null => text(value) ? value.normalize("NFC").trim() : null;
export function identityChecks(b: RecordEvidence,l: RecordEvidence) {
  return (["reference","counterparty"] as const).map(field=>{
    const a=normalizeIdentity(b[field]),z=normalizeIdentity(l[field]);
    const code=field==="reference"?"REFERENCE":"COUNTERPARTY";
    return check(a===null||z===null?code+"_MISSING":a!==z?code+"_CONFLICT":code+"_AGREEMENT",a!==null&&a===z?"PASS":"NOT_VERIFIED",b.id,l.id);
  });
}
