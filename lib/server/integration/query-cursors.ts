import "server-only";
import { batchTimestamp, parseBatchId } from "../api/batch-contract";
import type { BatchCursorBinding, BatchPosition } from "../api/batch-query";
import { parseTransactionId, parseTransactionListFilters } from "../api/transaction-contract";
import type { TransactionCursorBinding, TransactionPosition } from "../api/transaction-query";
import type { TrustedPrincipal } from "../security/authorization";
import { InvalidSecurityCursor, signTransactionCursor, verifyTransactionCursor, type CursorBinding } from "../security/secure-cursor";

const WRAPPER = /^[A-Za-z0-9_-]{1,512}$/;

function wrap(signed: string): string {
  const encoded = Buffer.from(signed, "ascii").toString("base64url");
  if (!WRAPPER.test(encoded)) throw new InvalidSecurityCursor();
  return encoded;
}

function unwrap(token: string): string {
  if (typeof token !== "string" || !WRAPPER.test(token)) throw new InvalidSecurityCursor();
  const bytes = Buffer.from(token, "base64url");
  if (bytes.toString("base64url") !== token) throw new InvalidSecurityCursor();
  const signed = bytes.toString("ascii");
  if (!Buffer.from(signed, "ascii").equals(bytes)) throw new InvalidSecurityCursor();
  const parts = signed.split(".");
  if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part)
    || Buffer.from(part, "base64url").toString("base64url") !== part)) throw new InvalidSecurityCursor();
  return signed;
}

function pair(value: string): [string, string] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 2 || !parsed.every(item => typeof item === "string")) throw new Error();
    return [parsed[0], parsed[1]];
  } catch { throw new InvalidSecurityCursor(); }
}

function transactionBinding(principal: TrustedPrincipal, binding: TransactionCursorBinding): CursorBinding {
  return { principal, access: binding.access, filters: { ...binding.filters, collection: "transactions" }, pageLimit: binding.filters.limit };
}

function batchBinding(principal: TrustedPrincipal, binding: BatchCursorBinding): CursorBinding {
  return { principal, access: binding.access, filters: { ...binding.filters, collection: binding.collection }, pageLimit: binding.filters.limit };
}

function transactionPosition(date: string, id: string): TransactionPosition {
  try {
    const parsed = parseTransactionListFilters(new URLSearchParams({ date_from: date }));
    if (parsed.dateFrom === null) throw new Error();
    return { canonicalDate: parsed.dateFrom, transactionId: parseTransactionId(id) };
  } catch { throw new InvalidSecurityCursor(); }
}

export function createTransactionCursorAdapter(principal: TrustedPrincipal, secret: string) {
  return {
    async issue(position: TransactionPosition, binding: TransactionCursorBinding): Promise<string> {
      const normalized = transactionPosition(position.canonicalDate, position.transactionId);
      return wrap(signTransactionCursor(JSON.stringify([normalized.canonicalDate, normalized.transactionId]), transactionBinding(principal, binding), secret));
    },
    async verify(token: string, binding: TransactionCursorBinding): Promise<TransactionPosition> {
      const verified = verifyTransactionCursor(unwrap(token), transactionBinding(principal, binding), secret);
      const [date, id] = pair(verified.position);
      return transactionPosition(date, id);
    },
  };
}

export function createBatchCursorAdapter(principal: TrustedPrincipal, secret: string) {
  return {
    async issue(position: BatchPosition, binding: BatchCursorBinding): Promise<string> {
      const values = [batchTimestamp(position.createdAt), parseBatchId(position.batchId)];
      return wrap(signTransactionCursor(JSON.stringify(values), batchBinding(principal, binding), secret));
    },
    async verify(token: string, binding: BatchCursorBinding): Promise<BatchPosition> {
      const verified = verifyTransactionCursor(unwrap(token), batchBinding(principal, binding), secret);
      const [date, id] = pair(verified.position);
      try { return { createdAt: batchTimestamp(date), batchId: parseBatchId(id) }; }
      catch { throw new InvalidSecurityCursor(); }
    },
  };
}
