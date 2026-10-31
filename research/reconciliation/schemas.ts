import type { SourceTemplate } from "./types";

/** Four deliberately distinct synthetic source schemas, not client-approved conventions. */
export const SOURCE_TEMPLATES: readonly SourceTemplate[] = [
  { id: "bank-signed-v1", role: "BANK", systemId: "synthetic-bank-a", accountId: "synthetic-bank-cash-a",
    monetaryBasis: "SIGNED_CASH", dateBasis: "TRANSACTION_DATE",
    columns: ["TxnDate", "BookedDate", "Narrative", "SignedMYR", "Currency", "Ref"],
    convention: "Positive cash inflow; negative cash outflow. Currency is explicit per row, despite the historical synthetic column name." },
  { id: "bank-directed-v1", role: "BANK", systemId: "synthetic-bank-b", accountId: "synthetic-bank-cash-b",
    monetaryBasis: "AMOUNT_DIRECTION", dateBasis: "POSTING_DATE",
    columns: ["ValueDate", "PostingDate", "Details", "Amount", "Movement", "CCY", "Reference"],
    convention: "Unsigned magnitude with explicit INFLOW/OUTFLOW; canonical posting date, transaction date may be unavailable." },
  { id: "ledger-cash-v1", role: "LEDGER", systemId: "synthetic-ledger-c", accountId: "synthetic-ledger-cash",
    monetaryBasis: "CASH_DEBIT_CREDIT", dateBasis: "TRANSACTION_DATE",
    columns: ["JournalDate", "Memo", "CashDebit", "CashCredit", "Currency", "Voucher"],
    convention: "Cash asset account: debit increases cash (inflow), credit decreases cash (outflow). Unused side is unavailable (null), not fabricated zero." },
  { id: "ledger-expense-v1", role: "LEDGER", systemId: "synthetic-ledger-d", accountId: "synthetic-expense-contra",
    monetaryBasis: "EXPENSE_DEBIT_CREDIT", dateBasis: "POSTING_DATE",
    columns: ["DocumentDate", "JournalPosting", "SupplierText", "ExpenseDR", "ReversalCR", "CCY", "DocRef"],
    convention: "Synthetic settled expense view only: debit denotes paid expense/outflow; credit denotes refunded expense/inflow. Not a general ledger-wide cash-direction rule." },
];
