/** Hand-written correct proposals for the public unfamiliar-layout samples (recorded-test doubles, not model output). */
import type { LayoutProposal } from '../../lib/interpretation/contracts';

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
        role: 'GENERAL_LEDGER', headerLine: 3,
        columns: { ...none, recordId: 0, date: 1, reference: 2, description: 3, counterparty: 4, amount: 5 },
        representation: 'SIGNED_AMOUNT', directionTokens: noTokens, dateFormat: 'YYYY-MM-DD', numberFormat: 'PLAIN',
        scope: { ...noScope, businessId: { line: 0, literal: 'DEMO-001' }, currency: { line: 1, literal: 'MYR' } },
        rationale: 'Recorded test proposal.', unresolved: [],
    },
};
