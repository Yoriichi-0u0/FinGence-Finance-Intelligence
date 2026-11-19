import 'server-only';
import { createHash } from 'node:crypto';
import Papa from 'papaparse';
import { CASH_SOURCE_FIELDS, cashCents, formatCents, reconcileCashSources } from '../../poc-reconciliation/engine';
import type { CashSource, CashSourceRow } from '../../poc-reconciliation/contracts';
import { normalizeCashSource } from '../poc-reconciliation/normalize';
import { approvedPoCSourceHashes } from '../poc-reconciliation/service';
export const PIPELINE_VERSION = 'db04-ai06-cash/1';
export interface VerificationPolicy {
    version: string;
    maxDays: number;
}
export const SAME_DAY_POLICY: Readonly<VerificationPolicy> = Object.freeze({ version: 'synthetic-cash-same-day/1', maxDays: 0 });
export const RESEARCH_TWO_DAY_POLICY: Readonly<VerificationPolicy> = Object.freeze({ version: 'synthetic-cash-two-day/1', maxDays: 2 });
export type RegisteredPair = Readonly<{
    bank: string;
    ledger: string;
}>;
export interface SourceInput {
    bytes: Uint8Array;
    filename: string;
}
export const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export type PreparedTransaction = {
    kind: 'BANK' | 'LEDGER';
    sha256: string;
    recordId: string;
    row: number;
    date: string;
    signedAmount: string;
    originalAmount: string;
    reference: string;
    evidence: Record<string, string>;
};
export interface VerifiedProposal {
    bankRecordId: string;
    ledgerRecordId: string;
    decision: 'VERIFIED_SUGGESTION' | 'UNRESOLVED';
    checks: Record<string, boolean>;
}
export function supportedPolicy(input: VerificationPolicy): VerificationPolicy {
    const known = [SAME_DAY_POLICY, RESEARCH_TWO_DAY_POLICY].find(p => p.version === input?.version && p.maxDays === input.maxDays);
    if (!known)
        throw Error('UNSUPPORTED_VERIFICATION_POLICY');
    return { ...known };
}
function readSource(input: SourceInput, kind: 'bank' | 'ledger', registered: RegisteredPair) {
    // Own bytes before hashing/parsing; never accept browser role claims or mutable normalized objects.
    const bytes = Uint8Array.from(input.bytes);
    if (digest(bytes) !== registered[kind])
        throw Error('REGISTERED_SYNTHETIC_SOURCES_REQUIRED');
    const parsed = Papa.parse<string[]>(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy', dynamicTyping: false });
    const headers = parsed.data[0];
    const allowed = [...CASH_SOURCE_FIELDS[kind], ...(kind === 'bank' ? ['BusinessName', 'AccountNumber', 'Counterparty'] : ['Counterparty', 'CategoryLabel'])];
    if (!headers || headers.some(h => !allowed.includes(h)) || CASH_SOURCE_FIELDS[kind].some(h => !headers.includes(h)))
        throw Error('UNSUPPORTED_SOURCE_CLASSIFICATION');
    const source = normalizeCashSource(bytes, kind, input.filename);
    const transactions = source.rows.map((r, index): PreparedTransaction => {
        const evidence = Object.fromEntries(headers.map((h, i) => [h, parsed.data[index + 1][i]]));
        return { kind: kind === 'bank' ? 'BANK' : 'LEDGER', sha256: source.sha256, recordId: r.recordId, row: r.row, date: r.date,
            signedAmount: formatCents(BigInt(r.signedCents)), originalAmount: evidence.SignedCashMovementMYR, reference: r.reference, evidence };
    });
    return { source, transactions, byteLength: bytes.length };
}
/** Independent checks do not consume matcher status, similarity or hidden evaluation labels. */
export function verifyPair(bank: CashSource, ledger: CashSource, b: CashSourceRow, l: CashSourceRow, policy: VerificationPolicy, transactions: PreparedTransaction[]): VerifiedProposal {
    const raw = (kind: string, id: string) => transactions.find(r => r.kind === kind && r.recordId === id)?.evidence;
    const br = raw('BANK', b.recordId), lr = raw('LEDGER', l.recordId);
    const bp = br?.Counterparty?.normalize('NFC').trim(), lp = lr?.Counterparty?.normalize('NFC').trim();
    const reference = b.reference.normalize('NFC').trim();
    const checks = {
        SOURCE_IDENTITY: bank.kind === 'bank' && ledger.kind === 'ledger' && bank.sha256 !== ledger.sha256 && b.sourceId === bank.sha256 && l.sourceId === ledger.sha256,
        SCOPE: bank.businessId === ledger.businessId && bank.period === ledger.period,
        EXACT_AMOUNT: cashCents(br?.SignedCashMovementMYR ?? 'invalid') === cashCents(lr?.SignedCashMovementMYR ?? 'invalid'),
        CURRENCY: b.currency === l.currency && b.currency === 'MYR',
        DIRECTION: (BigInt(b.signedCents) > 0n && BigInt(l.signedCents) > 0n) || (BigInt(b.signedCents) < 0n && BigInt(l.signedCents) < 0n),
        CANONICAL_DATE_POLICY: Math.abs(Date.parse(b.date) - Date.parse(l.date)) / 86400000 <= policy.maxDays,
        REFERENCE: !!reference && reference === l.reference.normalize('NFC').trim(),
        COUNTERPARTY: !!bp && bp === lp,
        UNIQUE_IDENTITY: bank.rows.filter(r => r.reference.normalize('NFC').trim() === reference).length === 1 && ledger.rows.filter(r => r.reference.normalize('NFC').trim() === reference).length === 1,
    };
    return { bankRecordId: b.recordId, ledgerRecordId: l.recordId, decision: Object.values(checks).every(Boolean) ? 'VERIFIED_SUGGESTION' : 'UNRESOLVED', checks };
}
export function prepareProcessing(organizationId: string, bankInput: SourceInput, ledgerInput: SourceInput, registered: RegisteredPair = approvedPoCSourceHashes, policyInput: VerificationPolicy = SAME_DAY_POLICY) {
    const policy = supportedPolicy(policyInput);
    const bank = readSource(bankInput, 'bank', registered), ledger = readSource(ledgerInput, 'ledger', registered);
    const snapshot = reconcileCashSources(organizationId, bank.source, ledger.source);
    const transactions = [...bank.transactions, ...ledger.transactions];
    const proposals: VerifiedProposal[] = [], cases: Array<{
        reason: string;
        evidence: object;
    }> = [];
    for (const result of snapshot.results) {
        // Group/partial and ambiguous cases never become one-to-one suggestions.
        if (result.bankRecordId && result.ledgerRecordIds.length === 1 && result.status !== 'AMBIGUOUS_DUPLICATE_LEDGER') {
            const b = bank.source.rows.find(r => r.recordId === result.bankRecordId)!;
            const l = ledger.source.rows.find(r => r.recordId === result.ledgerRecordIds[0])!;
            const decision = verifyPair(bank.source, ledger.source, b, l, policy, transactions);
            proposals.push(decision);
            if (decision.decision === 'UNRESOLVED')
                cases.push({ reason: 'FINANCIAL_VERIFICATION_UNRESOLVED', evidence: decision });
        }
        else
            cases.push({ reason: result.status, evidence: result });
    }
    const processingId = digest(JSON.stringify([PIPELINE_VERSION, organizationId, policy, ['BANK', bank.source.sha256], ['LEDGER', ledger.source.sha256]]));
    return { processingId, policy, bank, ledger, transactions, proposals, cases, status: cases.length ? 'COMPLETED_WITH_EXCEPTIONS' : 'COMPLETED' };
}
