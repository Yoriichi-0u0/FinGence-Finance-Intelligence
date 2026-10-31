import { evaluate } from "../ai02/evaluator";
import type { Input } from "../ai02/types";
import type { Truth } from "../m2/types";
import type { SemanticRun } from "./types";
import { baselineView } from "./semantic-ranker";
/** No inference imports this evaluator or receives its truth. All AI02 denominators retained. */
export function evaluateSemantic(input:Input,truth:Truth,run:SemanticRun){
  const metrics=evaluate(input,truth,baselineView(run));
  return {...metrics,method:"E2b" as const,inferenceKind:run.inferenceKind,
    ambiguousCasesForced:truth.ambiguous.filter(a=>a.bankIds.some(id=>run.suggestions.some(p=>p.bankId===id))).length};
}
