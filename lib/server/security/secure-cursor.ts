import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { TransactionAccess } from "./transaction-access";
import type { TrustedPrincipal } from "./authorization";
export interface CursorFilters { readonly [key: string]: string | number | boolean | null | readonly string[]; }
export interface CursorBinding { readonly principal: TrustedPrincipal; readonly access: TransactionAccess; readonly filters: CursorFilters; readonly pageLimit: number; }
export interface VerifiedCursor { readonly position: string; readonly expiresAt: number; }
const MAX_TTL_SECONDS = 900;
const ID = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
export class InvalidSecurityCursor extends Error {
  readonly code = "INVALID_SECURITY_CURSOR";
  constructor() { super("Invalid or expired cursor"); this.name = "InvalidSecurityCursor"; }
}
function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(d => "value" in d);
}
function canonicalFilters(filters: CursorFilters): string {
  if (!plainObject(filters)) throw new InvalidSecurityCursor();
  const descriptors = Object.getOwnPropertyDescriptors(filters);
  const entries = Object.keys(descriptors).sort().map(key => {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) throw new InvalidSecurityCursor();
    const value = descriptors[key].value;
    if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return [key, value];
    if (Array.isArray(value) && value.every(item => typeof item === "string")) return [key, [...value]];
    throw new InvalidSecurityCursor();
  });
  return JSON.stringify(entries);
}
function validateBinding(binding: CursorBinding): void {
  if (!binding || !binding.principal || !binding.access
    || !ID.test(binding.principal.subjectId) || !ID.test(binding.principal.organizationId)
    || !["administrator", "finance_analyst", "management_reviewer"].includes(binding.principal.role)
    || !ID.test(binding.access.scopeVersion) || binding.access.subjectId !== binding.principal.subjectId
    || binding.access.organizationId !== binding.principal.organizationId
    || !Array.isArray(binding.access.batchIds) || !binding.access.batchIds.every(id => typeof id === "string" && ID.test(id))
    || new Set(binding.access.batchIds).size !== binding.access.batchIds.length
    || !Number.isInteger(binding.pageLimit) || binding.pageLimit < 1 || binding.pageLimit > 500) throw new InvalidSecurityCursor();
  canonicalFilters(binding.filters);
}
function keyBytes(secret: string): Buffer {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) throw new InvalidSecurityCursor();
  return Buffer.from(secret, "utf8");
}
function fingerprint(binding: CursorBinding, secret: string): string {
  validateBinding(binding);
  return createHmac("sha256", keyBytes(secret)).update(JSON.stringify({
    subjectId: binding.principal.subjectId, organizationId: binding.principal.organizationId, role: binding.principal.role,
    scopeVersion: binding.access.scopeVersion, batchIds: [...binding.access.batchIds].sort(),
    filters: canonicalFilters(binding.filters), pageLimit: binding.pageLimit,
  })).digest("base64url");
}
function signature(body: string, secret: string): Buffer { return createHmac("sha256", keyBytes(secret)).update(body).digest(); }

/** Position is an opaque server-generated pagination key, not a query or SQL fragment. */
export function signTransactionCursor(position: string, binding: CursorBinding, secret: string,
  options: { now?: number; ttlSeconds?: number } = {}): string {
  if (typeof position !== "string" || position.length < 1 || position.length > 2048) throw new InvalidSecurityCursor();
  validateBinding(binding);
  const now = options.now ?? Date.now(), ttl = options.ttlSeconds ?? MAX_TTL_SECONDS;
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(now + ttl * 1000) || !Number.isInteger(ttl) || ttl < 1 || ttl > MAX_TTL_SECONDS) throw new InvalidSecurityCursor();
  const payload = Buffer.from(JSON.stringify({ v: 1, iat: now, exp: now + ttl * 1000, binding: fingerprint(binding, secret), position }), "utf8").toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

/** Rejects tampering, expiry, and any change in identity, data scope, filters, or page size. */
export function verifyTransactionCursor(token: string, binding: CursorBinding, secret: string, now = Date.now()): VerifiedCursor {
  try {
    validateBinding(binding);
    if (typeof token !== "string" || token.length > 8192 || !Number.isSafeInteger(now)) throw new Error();
    const parts = token.split(".");
    if (parts.length !== 2 || !B64URL.test(parts[0]) || !B64URL.test(parts[1])) throw new Error();
    const expected = signature(parts[0], secret), supplied = Buffer.from(parts[1], "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error();
    const payload: unknown = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!plainObject(payload)) throw new Error();
    const p = payload;
    if (Object.keys(p).sort().join(",") !== "binding,exp,iat,position,v" || p.v !== 1
      || typeof p.iat !== "number" || !Number.isSafeInteger(p.iat) || typeof p.exp !== "number" || !Number.isSafeInteger(p.exp)
      || typeof p.position !== "string" || p.position.length < 1 || p.position.length > 2048
      || typeof p.binding !== "string" || p.binding !== fingerprint(binding, secret)
      || p.exp <= now || p.iat > now + 30_000 || p.exp - p.iat > MAX_TTL_SECONDS * 1000 || p.exp <= p.iat) throw new Error();
    return Object.freeze({ position: p.position, expiresAt: p.exp });
  } catch { throw new InvalidSecurityCursor(); }
}
/** Provide SECURITY_CURSOR_SECRET from the deployment's server-side secret store. */
export function transactionCursorSecret(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const secret = environment.SECURITY_CURSOR_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) throw new Error("Security cursor signing key is not configured");
  return secret;
}
