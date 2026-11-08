import type { CanonicalTransaction, NormalizationTransformation, RawCell } from "../../ingestion/models";
import { normalizeDate, normalizeIngestionTimestamp, subtractDecimals } from "../../ingestion/normalizer";
import {
  PersistenceError, SUPPORTED_PERSISTENCE_VERSIONS,
  type AcceptedTransaction, type AcceptedValidationIssue, type PersistenceCounts,
  type ValidatedDataset, type ValidatedPersistenceInput,
} from "./contracts";

import { validateSourceFile } from "./source-file";

type ObjectValue = Record<string, unknown>;
function requireInput(condition: unknown): asserts condition {
  if (!condition) throw new PersistenceError("INVALID_INPUT");
}
function object(value: unknown): ObjectValue {
  requireInput(value !== null && typeof value === "object" && !Array.isArray(value));
  const prototype = Object.getPrototypeOf(value);
  requireInput(prototype === Object.prototype || prototype === null);
  // Internal JSON-like values only. Accessors must not execute during preflight.
  requireInput(Object.values(Object.getOwnPropertyDescriptors(value)).every(item => "value" in item));
  return value as ObjectValue;
}
function array(value: unknown): unknown[] {
  requireInput(Array.isArray(value));
  requireInput(Array.from({ length: value.length }, (_, index) =>
    Object.getOwnPropertyDescriptor(value, String(index))).every(item => item && "value" in item));
  return value;
}
function text(value: unknown): string {
  requireInput(typeof value === "string" && !value.includes("\u0000"));
  return value;
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}
function integer(value: unknown, minimum = 0): number {
  requireInput(typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= 2147483647);
  return value;
}
function enumValue<const T extends string>(value: unknown, choices: readonly T[]): T {
  requireInput(typeof value === "string" && choices.includes(value as T));
  return value as T;
}
function date(value: unknown): string {
  const result = text(value);
  requireInput(normalizeDate(result, "ISO") === result);
  return result;
}
function timestamp(value: unknown): string {
  const result = text(value);
  requireInput(normalizeIngestionTimestamp(result) === result);
  return result;
}
function decimal(value: unknown, maximum = 128): string | null {
  if (value === null) return null;
  const result = text(value);
  requireInput(result.length <= maximum && /^-?\d+(?:\.\d+)?$/.test(result));
  return result;
}
function rawCell(value: unknown): RawCell {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return text(value);
  const cell = object(value);
  requireInput(Object.keys(cell).length === 2);
  return { kind: enumValue(cell.kind, ["excel_date", "excel_number"]), value: text(cell.value) };
}
function issue(value: unknown, accepted: boolean): AcceptedValidationIssue | (Omit<AcceptedValidationIssue, "severity"> & { severity: "REJECTED" }) {
  const input = object(value);
  const severity = enumValue(input.severity, ["WARNING", "REJECTED"]);
  requireInput(!accepted || severity === "WARNING");
  return {
    rule: text(input.rule), category: enumValue(input.category, ["technical", "business"]),
    severity, field: text(input.field), sourceColumn: nullableText(input.sourceColumn),
    originalValue: rawCell(input.originalValue), message: text(input.message),
  };
}
function transformation(value: unknown): NormalizationTransformation {
  const input = object(value);
  return {
    field: enumValue(input.field, ["debit", "credit"]),
    source_column: nullableText(input.source_column), original_value: rawCell(input.original_value),
    normalized_value: enumValue(input.normalized_value, ["0"]),
    rule: enumValue(input.rule, ["APPROVED_BLANK_SIDE_ZERO"]),
  };
}

/** JSON object key order is immaterial; array order (including issues) is not. */
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    const a = array(left), b = array(right);
    return a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  const a = object(left), b = object(right), keys = Object.keys(a);
  return keys.length === Object.keys(b).length
    && keys.every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}

interface DatasetContext {
  batchId: string; ingestedAt: string; hash: string; file: string; sheet: string | null;
  sheetIndex: number; sourceSystem: string;
}
function provenance(value: unknown, context: DatasetContext) {
  const input = object(value);
  const result = {
    source_system: text(input.source_system), source_file: text(input.source_file),
    source_sheet: nullableText(input.source_sheet), source_row_number: integer(input.source_row_number, 1),
    source_row_id: text(input.source_row_id), file_sha256: text(input.file_sha256),
    ingestion_batch_id: text(input.ingestion_batch_id), ingested_at: timestamp(input.ingested_at),
  };
  requireInput(result.source_system === context.sourceSystem && result.source_file === context.file
    && result.source_sheet === context.sheet && result.file_sha256 === context.hash
    && result.ingestion_batch_id === context.batchId && result.ingested_at === context.ingestedAt
    && result.source_row_id === `${context.hash}:${context.sheetIndex}:${result.source_row_number}`);
  return result;
}
function canonical(value: unknown, context: DatasetContext): AcceptedTransaction {
  const input = object(value);
  const result: AcceptedTransaction = {
    ...provenance(input, context),
    transaction_date: input.transaction_date === null ? null : date(input.transaction_date),
    posting_date: input.posting_date === null ? null : date(input.posting_date),
    canonical_date: date(input.canonical_date),
    canonical_date_basis: enumValue(input.canonical_date_basis, ["TRANSACTION_DATE", "POSTING_DATE"]),
    reference: nullableText(input.reference), source_transaction_id: nullableText(input.source_transaction_id),
    account_code: nullableText(input.account_code), account_id: nullableText(input.account_id),
    entity_id: nullableText(input.entity_id), description: nullableText(input.description),
    counterparty: nullableText(input.counterparty), debit: decimal(input.debit), credit: decimal(input.credit),
    source_amount: decimal(input.source_amount), derived_ledger_net: decimal(input.derived_ledger_net, 260),
    balance: decimal(input.balance), entry_side: input.entry_side === null ? null : enumValue(input.entry_side, ["DEBIT", "CREDIT"]),
    monetary_basis: enumValue(input.monetary_basis, ["source_signed_amount", "source_amount_with_direction", "debit_credit"]),
    currency: nullableText(input.currency),
    currency_basis: input.currency_basis === null ? null : enumValue(input.currency_basis, ["SOURCE", "DATASET_DEFAULT"]),
    transformations: array(input.transformations).map(transformation),
    ingestion_status: enumValue(input.ingestion_status, ["VALID", "WARNING"]),
    validation_messages: array(input.validation_messages).map(item => issue(item, true) as AcceptedValidationIssue),
  };
  requireInput(result.canonical_date === (result.canonical_date_basis === "TRANSACTION_DATE"
    ? result.transaction_date : result.posting_date));
  requireInput((result.ingestion_status === "VALID") === (result.validation_messages.length === 0));
  requireInput((result.currency === null) === (result.currency_basis === null));
  if (result.monetary_basis === "debit_credit") {
    requireInput(result.debit !== null && result.credit !== null && result.derived_ledger_net !== null);
    requireInput(subtractDecimals(result.derived_ledger_net, subtractDecimals(result.debit, result.credit)) === "0");
  } else {
    requireInput(result.source_amount !== null && result.derived_ledger_net === null);
    if (result.monetary_basis === "source_amount_with_direction") {
      requireInput(result.entry_side !== null && (!result.source_amount.startsWith("-")
        || /^-0(?:\.0+)?$/.test(result.source_amount)));
    }
  }
  for (const item of result.transformations) {
    requireInput(result.monetary_basis === "debit_credit" && result[item.field] === "0");
    const original = item.original_value;
    requireInput(original === null || (typeof original === "string" && original.trim() === "")
      || (typeof original === "object" && original.value.trim() === ""));
  }
  requireInput(new Set(result.transformations.map(item => item.field)).size === result.transformations.length);
  return result;
}

function validateResult(value: unknown): { batchId: string; dataset: ValidatedDataset } {
  const result = object(value);
  const dataset = object(result.dataset), file = object(dataset.file), sheet = object(dataset.sheet);
  const options = object(result.options), producer = object(result.context);
  const context: DatasetContext = {
    batchId: text(producer.batchId), ingestedAt: timestamp(producer.ingestedAt),
    hash: text(file.fingerprint), file: text(file.name), sheet: nullableText(sheet.name),
    sheetIndex: integer(sheet.index), sourceSystem: text(options.sourceSystem).trim(),
  };
  requireInput(context.batchId.trim().length > 0 && /^[0-9a-f]{64}$/.test(context.hash));
  const datasetId = text(dataset.id);
  requireInput(datasetId === `${context.hash}:${context.sheetIndex}`);
  const dateBasis = enumValue(options.dateBasis, ["transaction_date", "posting_date"]);
  const monetaryMode = enumValue(options.monetaryMode, ["debit_credit", "signed_amount", "amount_direction"]);
  const expectedMoney = monetaryMode === "signed_amount" ? "source_signed_amount"
    : monetaryMode === "amount_direction" ? "source_amount_with_direction" : "debit_credit";
  const counts: PersistenceCounts = { rows_received: 0, valid_count: 0, warning_count: 0, rejected_count: 0 };
  const accepted = new Map<string, { status: "VALID" | "WARNING"; issues: unknown[]; candidate: ObjectValue }>();
  const processed = array(result.records), sourceRows = array(dataset.rows);
  requireInput(sourceRows.length === processed.length);
  const seenRows = new Set<number>();
  for (const [index, value] of processed.entries()) {
    const row = object(value), lineage = provenance(row.provenance, context);
    const raw = object(row.raw), sourceRow = object(sourceRows[index]);
    requireInput(integer(raw.rowNumber, 1) === lineage.source_row_number
      && integer(sourceRow.rowNumber, 1) === lineage.source_row_number && !seenRows.has(lineage.source_row_number));
    seenRows.add(lineage.source_row_number);
    const status = enumValue(row.status, ["VALID", "WARNING", "REJECTED"]);
    const issues = array(row.issues).map(item => issue(item, status !== "REJECTED"));
    requireInput(status === "REJECTED" ? issues.some(item => item.severity === "REJECTED")
      : (status === "VALID") === (issues.length === 0));
    counts.rows_received++;
    if (status === "REJECTED") counts.rejected_count++;
    else {
      if (status === "VALID") counts.valid_count++; else counts.warning_count++;
      accepted.set(lineage.source_row_id, { status, issues, candidate: object(row.candidate) });
    }
  }
  const records = array(result.normalized).map(value => {
    const record = canonical(value, context), evidence = accepted.get(record.source_row_id);
    requireInput(evidence && evidence.status === record.ingestion_status);
    requireInput(sameValue(evidence.issues, record.validation_messages));
    // Compare every persisted canonical field against the accepted candidate.
    for (const key of Object.keys(record) as (keyof CanonicalTransaction)[]) {
      if (key !== "ingestion_status" && key !== "validation_messages") {
        requireInput(sameValue(evidence.candidate[key], record[key]));
      }
    }
    requireInput(record.canonical_date_basis === (dateBasis === "transaction_date" ? "TRANSACTION_DATE" : "POSTING_DATE")
      && record.monetary_basis === expectedMoney);
    if (record.transformations.length) requireInput(options.blankSideAsZero === true);
    accepted.delete(record.source_row_id);
    return record;
  });
  requireInput(accepted.size === 0);
  const summary = object(result.summary);
  requireInput(integer(summary.rowsReceived) === counts.rows_received
    && integer(summary.valid) === counts.valid_count && integer(summary.warning) === counts.warning_count
    && integer(summary.rejected) === counts.rejected_count
    && integer(summary.accepted) === records.length
    && records.length === counts.valid_count + counts.warning_count);
  return { batchId: context.batchId, dataset: { dataset_id: datasetId, counts, records } };
}

/** Pure internal preflight. Does not authenticate callers or validate full raw exports. */
export function validatePersistenceRequest(input: unknown): ValidatedPersistenceInput {
  try {
    const request = object(input);
    const results = array(request.results);
    requireInput(results.length > 0);
    // Version-gate ALL supplied results, even ones later replaced by consolidation.
    for (const value of results) {
      const result = object(value);
      for (const key of ["schema_version", "ruleset_version"] as const) {
        requireInput(typeof result[key] === "string");
        if (result[key] !== SUPPORTED_PERSISTENCE_VERSIONS[key]) throw new PersistenceError("UNSUPPORTED_VERSION");
      }
    }
    const validated = results.map(validateResult);
    const filenames = results.map(value => validateSourceFile(object(object(object(value).dataset).file).name));
    const source_file = validateSourceFile(request.source_file === undefined ? filenames[0] : request.source_file);
    requireInput(filenames.every(name => name === source_file));
    const batchId = validated[0].batchId;
    if (validated.some(item => item.batchId !== batchId)) throw new PersistenceError("MIXED_BATCH_IDS");
    const datasets = [...new Map(validated.map(item => [item.dataset.dataset_id, item.dataset])).values()];
    const total = datasets.reduce((sum, item) => sum + item.counts.rows_received, 0);
    integer(total);
    return { ...SUPPORTED_PERSISTENCE_VERSIONS, source_file, ingestion_batch_id: batchId, datasets };
  } catch (error) {
    if (error instanceof PersistenceError) throw error;
    throw new PersistenceError("INVALID_INPUT");
  }
}
