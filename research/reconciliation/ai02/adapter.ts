import { developmentCandidates } from "../m2/access";
import type { Input } from "./types";
/** Raw approved AI01 input validation happens here, outside the label-free matching core. */
export function prepareDevelopment(input: unknown): Input {
  const projection = developmentCandidates(input);
  if (projection.split === "heldout") throw new Error("Held-out evaluation is not authorized in AI02");
  return { version: projection.version, split: projection.split, candidates: projection.candidates };
}
