import 'server-only';
import { createHash } from 'node:crypto';
import type { CashSource, CashSourceKind } from '../../poc-reconciliation/contracts';
import { normalizeCashSourceBytes } from '../../poc-reconciliation/engine';
export { cashCents, formatCents } from '../../poc-reconciliation/engine';
/** Server wrapper: hashes with Node crypto, then runs the shared pure normalizer. */
export function normalizeCashSource(bytes: Uint8Array, kind: CashSourceKind, filename: string): CashSource {
    return normalizeCashSourceBytes(bytes, kind, filename, createHash('sha256').update(bytes).digest('hex'));
}
