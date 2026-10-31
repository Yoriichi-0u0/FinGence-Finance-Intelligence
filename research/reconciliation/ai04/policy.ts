import type { Policy } from "./types";
export const VERIFIER_VERSION = "ai04/1.0.0";
export const POLICY: Readonly<Policy> = Object.freeze({ version: "ai04-policy/1.0.0", dateField: "canonicalDate", maxDays: 2, scope: "SYNTHETIC_SPLIT_COHORT", identity: "EXACT_REFERENCE_AND_COUNTERPARTY" });
/** No caller-selected tolerance, silent defaults or confidence overrides. */
export function assertPolicy(policy: Policy): void {
  if (!policy || Object.keys(policy).length !== Object.keys(POLICY).length || Object.entries(POLICY).some(([k,v]) => policy[k as keyof Policy] !== v)) throw new Error("Missing or unsupported AI04 policy");
}
