import "server-only";

/**
 * Phase 6A internal contract only. Not an HTTP route or authorization guard.
 * Do not query financial data before trusted identity, scoped access and
 * protected required audit persistence are integrated.
 */
export const TRANSACTION_PAGE_MAX = 100;
export const TRANSACTION_PAGE_DEFAULT = 25;

export type TransactionStatus = "VALID" | "WARNING";
export type MonetaryBasis = "debit_credit" | "source_signed_amount" | "source_amount_with_direction";
export type CanonicalDateBasis = "TRANSACTION_DATE" | "POSTING_DATE";
export type CurrencyBasis = "SOURCE" | "DATASET_DEFAULT";

export interface TransactionListFilters {
  readonly limit: number;
  /** Opaque and untrusted; a route must verify and bind it to filters/identity. */
  readonly cursor: string | null;
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
  readonly batchId: string | null;
  readonly status: TransactionStatus | null;
  readonly currency: string | null;
  readonly monetaryBasis: MonetaryBasis | null;
}

export class InvalidTransactionContractError extends Error {
  readonly code = "INVALID_TRANSACTION_CONTRACT" as const;
  constructor() {
    super("Invalid transaction request or projection");
    this.name = "InvalidTransactionContractError";
  }
}

const acceptedKeys = new Set([
  "limit", "cursor", "date_from", "date_to", "batch_id", "status", "currency", "monetary_basis",
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const monetaryBasisValues = new Set<string>([
  "debit_credit", "source_signed_amount", "source_amount_with_direction",
]);

function requiredIsoDate(value: unknown): string {
  if (typeof value !== "string" || !datePattern.test(value)) throw new InvalidTransactionContractError();
  const parsed = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new InvalidTransactionContractError();
  }
  return value;
}

function optionalIsoDate(value: unknown): string | null {
  return value === null ? null : requiredIsoDate(value);
}

function optionalText(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new InvalidTransactionContractError();
  return value;
}

function optionalMoney(value: unknown): string | null {
  const text = optionalText(value);
  if (text !== null && !decimalPattern.test(text)) throw new InvalidTransactionContractError();
  return text;
}

/** Validate input only: does not authorize batch_id or verify a cursor. */
export function parseTransactionListFilters(parameters: URLSearchParams): TransactionListFilters {
  if (!(parameters instanceof URLSearchParams)) throw new InvalidTransactionContractError();
  for (const [key] of parameters) {
    if (!acceptedKeys.has(key) || parameters.getAll(key).length !== 1) {
      throw new InvalidTransactionContractError();
    }
  }
  const limitRaw = parameters.get("limit");
  if (limitRaw !== null && !/^[1-9]\d{0,2}$/.test(limitRaw)) throw new InvalidTransactionContractError();
  const limit = limitRaw === null ? TRANSACTION_PAGE_DEFAULT : Number(limitRaw);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > TRANSACTION_PAGE_MAX) {
    throw new InvalidTransactionContractError();
  }
  const cursor = parameters.get("cursor");
  if (cursor !== null && !/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) {
    throw new InvalidTransactionContractError();
  }
  const dateFromRaw = parameters.get("date_from");
  const dateToRaw = parameters.get("date_to");
  const dateFrom = dateFromRaw === null ? null : requiredIsoDate(dateFromRaw);
  const dateTo = dateToRaw === null ? null : requiredIsoDate(dateToRaw);
  if (dateFrom !== null && dateTo !== null && dateFrom > dateTo) {
    throw new InvalidTransactionContractError();
  }
  const batchId = parameters.get("batch_id");
  if (batchId !== null && !uuidPattern.test(batchId)) throw new InvalidTransactionContractError();
  const status = parameters.get("status");
  if (status !== null && status !== "VALID" && status !== "WARNING") {
    throw new InvalidTransactionContractError();
  }
  const currency = parameters.get("currency");
  if (currency !== null && !/^[A-Z]{3}$/.test(currency)) throw new InvalidTransactionContractError();
  const monetaryBasis = parameters.get("monetary_basis");
  if (monetaryBasis !== null && !monetaryBasisValues.has(monetaryBasis)) {
    throw new InvalidTransactionContractError();
  }
  return Object.freeze({
    limit, cursor, dateFrom, dateTo, batchId,
    status: status as TransactionStatus | null,
    currency,
    monetaryBasis: monetaryBasis as MonetaryBasis | null,
  });
}

/** Explicit response allowlist: never include raw rows or rejected evidence. */
export interface TransactionListItem {
  readonly transaction_id: string;
  readonly batch_id: string;
  readonly ingestion_batch_id: string;
  readonly source_row_id: string;
  readonly canonical_date: string;
  readonly transaction_date: string | null;
  readonly posting_date: string | null;
  readonly canonical_date_basis: CanonicalDateBasis;
  readonly reference: string | null;
  readonly source_transaction_id: string | null;
  readonly description: string | null;
  readonly account_code: string | null;
  readonly monetary_basis: MonetaryBasis;
  readonly debit: string | null;
  readonly credit: string | null;
  readonly source_amount: string | null;
  readonly derived_ledger_net: string | null;
  readonly balance: string | null;
  readonly currency: string | null;
  readonly currency_basis: CurrencyBasis | null;
  readonly ingestion_status: TransactionStatus;
}

/** Only map rows from a trusted, organization-scoped query selecting dates/NUMERIC as ::text. */
export function projectTransactionRow(input: unknown): TransactionListItem {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidTransactionContractError();
  }
  const row = input as Record<string, unknown>;
  if (typeof row.id !== "string" || !uuidPattern.test(row.id)
    || typeof row.batch_id !== "string" || !uuidPattern.test(row.batch_id)
    || typeof row.ingestion_batch_id !== "string" || row.ingestion_batch_id.length === 0
    || typeof row.source_row_id !== "string" || row.source_row_id.length === 0
    || (row.canonical_date_basis !== "TRANSACTION_DATE" && row.canonical_date_basis !== "POSTING_DATE")
    || (row.ingestion_status !== "VALID" && row.ingestion_status !== "WARNING")
    || !monetaryBasisValues.has(String(row.monetary_basis))
    || (row.currency_basis !== null && row.currency_basis !== "SOURCE" && row.currency_basis !== "DATASET_DEFAULT")) {
    throw new InvalidTransactionContractError();
  }
  const canonicalDate = requiredIsoDate(row.canonical_date);
  const transactionDate = optionalIsoDate(row.transaction_date);
  const postingDate = optionalIsoDate(row.posting_date);
  if ((row.canonical_date_basis === "TRANSACTION_DATE" && transactionDate !== canonicalDate)
    || (row.canonical_date_basis === "POSTING_DATE" && postingDate !== canonicalDate)) {
    throw new InvalidTransactionContractError();
  }
  const debit = optionalMoney(row.debit);
  const credit = optionalMoney(row.credit);
  const sourceAmount = optionalMoney(row.source_amount);
  const derivedLedgerNet = optionalMoney(row.derived_ledger_net);
  const currency = optionalText(row.currency);
  if ((currency === null) !== (row.currency_basis === null)) throw new InvalidTransactionContractError();
  if ((row.monetary_basis === "debit_credit" && (debit === null || credit === null || derivedLedgerNet === null))
    || (row.monetary_basis !== "debit_credit" && (sourceAmount === null || derivedLedgerNet !== null))) {
    throw new InvalidTransactionContractError();
  }
  if (row.monetary_basis === "source_amount_with_direction"
    && ((row.entry_side !== "DEBIT" && row.entry_side !== "CREDIT") || sourceAmount?.startsWith("-") === true)) {
    throw new InvalidTransactionContractError();
  }
  return Object.freeze({
    transaction_id: row.id,
    batch_id: row.batch_id,
    ingestion_batch_id: row.ingestion_batch_id,
    source_row_id: row.source_row_id,
    canonical_date: canonicalDate,
    transaction_date: transactionDate,
    posting_date: postingDate,
    canonical_date_basis: row.canonical_date_basis,
    reference: optionalText(row.reference),
    source_transaction_id: optionalText(row.source_transaction_id),
    description: optionalText(row.description),
    account_code: optionalText(row.account_code),
    monetary_basis: row.monetary_basis as MonetaryBasis,
    debit, credit,
    source_amount: sourceAmount,
    derived_ledger_net: derivedLedgerNet,
    balance: optionalMoney(row.balance),
    currency,
    currency_basis: row.currency_basis as CurrencyBasis | null,
    ingestion_status: row.ingestion_status,
  });
}
