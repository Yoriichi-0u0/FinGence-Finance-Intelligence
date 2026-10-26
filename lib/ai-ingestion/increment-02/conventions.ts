import type { DateOrder, NumberFormat, RawCell } from "../../ingestion/models";
import { normalizeDate, normalizeDecimal } from "../../ingestion/normalizer";
/** Distinct parse spellings may be equivalent; different normalized meanings are not. */
function uniqueMeaning<T extends string>(values: RawCell[], choices: readonly T[], parse: (value: RawCell, choice: T) => string, proposed: T): boolean {
  const informative = values.filter(v => choices.some(c => { try { parse(v, c); return true; } catch { return false; } }));
  if (!informative.length) return true; // Invalid/missing values are rejected/held per row, never invented.
  const possible = choices.flatMap(c => { try { return [{ choice: c, vector: JSON.stringify(informative.map(v => parse(v, c))) }]; } catch { return []; } });
  return possible.some(c => c.choice === proposed) && new Set(possible.map(c => c.vector)).size === 1;
}
export function datesUnambiguous(values: RawCell[], proposed: DateOrder) { return uniqueMeaning(values, ["ISO", "DMY", "MDY"], normalizeDate, proposed); }
export function numbersUnambiguous(values: RawCell[], proposed: NumberFormat) { return uniqueMeaning(values, ["plain", "dot_comma", "comma_dot"], normalizeDecimal, proposed); }
