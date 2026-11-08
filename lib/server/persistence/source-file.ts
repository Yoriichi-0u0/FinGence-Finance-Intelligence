import { PersistenceError } from "./contracts";

/** Validate provenance without rewriting a useful filename. Never accept a path. */
export function validateSourceFile(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || [...value].length > 255
    || /[\\/\p{Cc}]/u.test(value) || value === "." || value === "..") {
    throw new PersistenceError("INVALID_INPUT");
  }
  return value;
}
