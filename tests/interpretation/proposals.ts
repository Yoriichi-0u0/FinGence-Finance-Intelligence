/** Hand-written correct proposals for the public unfamiliar-layout samples (recorded-test doubles, not model output). */
import type { LayoutProposal, ModelProposal } from '../../lib/interpretation/contracts';

/** Expresses a flat proposal in the v2 model contract (what a strict-schema model emits). */
export function wire(p: LayoutProposal): ModelProposal {
    const { rationale, unresolved } = p;
    if (p.role === 'UNSUPPORTED') return { layout: { role: 'UNSUPPORTED' }, rationale, unresolved };
    const c = p.columns, text = { recordId: c.recordId, date: c.date!, reference: c.reference!, description: c.description!, counterparty: c.counterparty, balance: c.balance, currency: c.currency, businessId: c.businessId, businessName: c.businessName };
    const money = p.representation === 'SIGNED_AMOUNT' ? { representation: 'SIGNED_AMOUNT' as const, amount: c.amount! }
        : p.representation === 'AMOUNT_AND_DIRECTION' ? { representation: 'AMOUNT_AND_DIRECTION' as const, amount: c.amount!, direction: c.direction!, inflowTokens: p.directionTokens.inflow, outflowTokens: p.directionTokens.outflow }
            : p.representation === 'SPLIT_IN_OUT' ? { representation: 'SPLIT_IN_OUT' as const, moneyIn: c.moneyIn!, moneyOut: c.moneyOut! } : { representation: 'DEBIT_CREDIT' as const, debit: c.debit!, credit: c.credit! };
    const table = { headerLine: p.headerLine, dateFormat: p.dateFormat, numberFormat: p.numberFormat, scope: p.scope };
    return p.role === 'BANK_STATEMENT'
        ? { layout: { role: 'BANK_STATEMENT', ...table, columns: text, money: money as Extract<typeof money, { representation: 'SIGNED_AMOUNT' | 'AMOUNT_AND_DIRECTION' | 'SPLIT_IN_OUT' }> }, rationale, unresolved }
        : { layout: { role: 'GENERAL_LEDGER', ...table, columns: { ...text, account: c.account }, money: money as Extract<typeof money, { representation: 'SIGNED_AMOUNT' | 'AMOUNT_AND_DIRECTION' | 'DEBIT_CREDIT' }> }, rationale, unresolved };
}

const none = { recordId: null, date: null, reference: null, description: null, counterparty: null, amount: null, direction: null, moneyIn: null, moneyOut: null, debit: null, credit: null, balance: null, account: null, currency: null, businessId: null, businessName: null };
const noTokens = { inflow: [], outflow: [] };
const noScope = { businessId: null, businessName: null, currency: null, statementPeriod: null };

export const CORRECT: Record<string, LayoutProposal> = {
    'bank-statement-march-2026-export.csv': {
        role: 'BANK_STATEMENT', headerLine: 8,
        columns: { ...none, date: 0, recordId: 1, reference: 2, description: 3, counterparty: 4, moneyOut: 5, moneyIn: 6, balance: 7 },
        representation: 'SPLIT_IN_OUT', directionTokens: noTokens, dateFormat: 'DD/MM/YYYY', numberFormat: 'COMMA_THOUSANDS_DOT_DECIMAL',
        scope: { businessId: { line: 2, literal: 'DEMO-001' }, businessName: { line: 1, literal: 'Rimba Demo Kitchen (Synthetic)' }, currency: { line: 5, literal: 'MYR' }, statementPeriod: { line: 4, literal: '01/03/2026 to 31/03/2026' } },
        rationale: 'Recorded test proposal.', unresolved: [],
    },
    'general-ledger-cash-march-2026.csv': {
        role: 'GENERAL_LEDGER', headerLine: 6,
        columns: { ...none, date: 0, recordId: 1, reference: 2, description: 3, counterparty: 4, debit: 5, credit: 6 },
        representation: 'DEBIT_CREDIT', directionTokens: noTokens, dateFormat: 'DD-Mon-YYYY', numberFormat: 'COMMA_THOUSANDS_DOT_DECIMAL',
        scope: { businessId: { line: 1, literal: 'DEMO-001' }, businessName: { line: 0, literal: 'Rimba Demo Kitchen (Synthetic)' }, currency: { line: 4, literal: 'RM' }, statementPeriod: { line: 3, literal: 'March 2026' } },
        rationale: 'Recorded test proposal.', unresolved: [],
    },
    'penyata-bank-mac-2026.csv': {
        role: 'BANK_STATEMENT', headerLine: 6,
        columns: { ...none, date: 0, reference: 1, description: 2, counterparty: 3, amount: 4, direction: 5, balance: 6 },
        representation: 'AMOUNT_AND_DIRECTION', directionTokens: { inflow: ['CR'], outflow: ['DR'] }, dateFormat: 'DD.MM.YYYY', numberFormat: 'DOT_THOUSANDS_COMMA_DECIMAL',
        scope: { businessId: { line: 2, literal: 'DEMO-001' }, businessName: { line: 1, literal: 'Rimba Demo Kitchen (Synthetic)' }, currency: { line: 4, literal: 'MYR' }, statementPeriod: { line: 3, literal: 'Mac 2026' } },
        rationale: 'Recorded test proposal.', unresolved: [],
    },
    'ledger-signed-march-2026.csv': {
        role: 'GENERAL_LEDGER', headerLine: 4,
        columns: { ...none, recordId: 0, date: 1, reference: 2, description: 3, counterparty: 4, amount: 5 },
        representation: 'SIGNED_AMOUNT', directionTokens: noTokens, dateFormat: 'YYYY-MM-DD', numberFormat: 'PLAIN',
        scope: { ...noScope, businessId: { line: 1, literal: 'DEMO-001' }, currency: { line: 2, literal: 'MYR' } },
        rationale: 'Recorded test proposal.', unresolved: [],
    },
    // Worksheets of the public Excel workbook: the same layouts with typed cells, so ISO dates and plain stored numbers.
    'rimba-demo-kitchen-march-2026.xlsx › Bank statement': {
        role: 'BANK_STATEMENT', headerLine: 8,
        columns: { ...none, date: 0, recordId: 1, reference: 2, description: 3, counterparty: 4, moneyOut: 5, moneyIn: 6, balance: 7 },
        representation: 'SPLIT_IN_OUT', directionTokens: noTokens, dateFormat: 'YYYY-MM-DD', numberFormat: 'PLAIN',
        scope: { businessId: { line: 2, literal: 'DEMO-001' }, businessName: { line: 1, literal: 'Rimba Demo Kitchen (Synthetic)' }, currency: { line: 5, literal: 'MYR' }, statementPeriod: { line: 4, literal: '01/03/2026 to 31/03/2026' } },
        rationale: 'Recorded test proposal.', unresolved: [],
    },
    'rimba-demo-kitchen-march-2026.xlsx › Cash ledger': {
        role: 'GENERAL_LEDGER', headerLine: 6,
        columns: { ...none, date: 0, recordId: 1, reference: 2, description: 3, counterparty: 4, debit: 5, credit: 6 },
        representation: 'DEBIT_CREDIT', directionTokens: noTokens, dateFormat: 'YYYY-MM-DD', numberFormat: 'PLAIN',
        scope: { businessId: { line: 1, literal: 'DEMO-001' }, businessName: { line: 0, literal: 'Rimba Demo Kitchen (Synthetic)' }, currency: { line: 4, literal: 'RM' }, statementPeriod: { line: 3, literal: 'March 2026' } },
        rationale: 'Recorded test proposal.', unresolved: [],
    },
    // Adversarial fixtures that ARE acceptable: bank statements without a running balance whose headings or tokens state direction.
    'bank-debit-credit-no-balance.csv': {
        role: 'BANK_STATEMENT', headerLine: 6,
        columns: { ...none, date: 0, recordId: 1, reference: 2, description: 3, counterparty: 4, moneyOut: 5, moneyIn: 6 },
        representation: 'SPLIT_IN_OUT', directionTokens: noTokens, dateFormat: 'DD/MM/YYYY', numberFormat: 'COMMA_THOUSANDS_DOT_DECIMAL',
        scope: { businessId: { line: 2, literal: 'DEMO-001' }, businessName: { line: 1, literal: 'Rimba Demo Kitchen (Synthetic)' }, currency: { line: 4, literal: 'MYR' }, statementPeriod: { line: 3, literal: '01/03/2026 to 31/03/2026' } },
        rationale: 'Recorded test proposal.', unresolved: [],
    },
    'bank-dr-cr-no-balance.csv': {
        role: 'BANK_STATEMENT', headerLine: 6,
        columns: { ...none, date: 0, recordId: 1, reference: 2, description: 3, counterparty: 4, amount: 5, direction: 6 },
        representation: 'AMOUNT_AND_DIRECTION', directionTokens: { inflow: ['CR'], outflow: ['DR'] }, dateFormat: 'DD/MM/YYYY', numberFormat: 'COMMA_THOUSANDS_DOT_DECIMAL',
        scope: { businessId: { line: 2, literal: 'DEMO-001' }, businessName: { line: 1, literal: 'Rimba Demo Kitchen (Synthetic)' }, currency: { line: 4, literal: 'MYR' }, statementPeriod: { line: 3, literal: '01/03/2026 to 31/03/2026' } },
        rationale: 'Recorded test proposal.', unresolved: [],
    },
};
