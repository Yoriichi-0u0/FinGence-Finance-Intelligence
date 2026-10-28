import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { localAccessAllowed } from "../service";

/** Local synthetic capability only; never a substitute for application identity. */
export function localTenant(request: Request): string | null {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL || process.env.FINGENCE_V2_I1_LOCAL !== "1" || !localAccessAllowed(request)) return null;
  const expected = process.env.FINGENCE_V2_I1_TOKEN;
  const supplied = request.headers.get("authorization")?.match(/^Bearer ([0-9a-f]{64})$/)?.[1];
  if (!expected || !/^[0-9a-f]{64}$/.test(expected) || !supplied) return null;
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"))) return null;
  const digest = createHmac("sha256", Buffer.from(expected, "hex")).update("synthetic-v2-i1-tenant").digest("hex").slice(0, 32);
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20)}`;
}
