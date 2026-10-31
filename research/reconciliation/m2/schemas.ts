import type { Split, Template } from "./types";
export const VERSION = "ai01-m2/1.1.0";
export const DEFAULT_SEED = "fingence-ai01-m2-frozen-001";
export const SPLITS: readonly Split[] = ["train", "development", "heldout"];
export const PERIODS: Record<Split, string> = { train: "2024-01", development: "2025-04", heldout: "2026-07" };

/** Logical source schemas only. No CSV/XLSX parser or ingestion adapter. */
export const TEMPLATES: readonly Template[] = [
  { id: "m2-bank-structured", split: "train", role: "BANK", systemId: "synthetic-retail-bank", accountId: "cash-retail", basis: "SIGNED_CASH", dateBasis: "TRANSACTION_DATE", format: "CSV", sourceDateFormat: "ISO",
    fields: { transactionDate: "ValueDate", postingDate: "BookDate", sourceAmount: "SignedMovement", currency: "CCY", reference: "StructuredRef", description: "Narrative" }, convention: "Positive cash receipts; negative withdrawals; structured references." },
  { id: "m2-ledger-cash", split: "train", role: "LEDGER", systemId: "synthetic-cash-book", accountId: "asset-cash", basis: "CASH_DEBIT_CREDIT", dateBasis: "TRANSACTION_DATE", format: "JOURNAL_EXPORT", sourceDateFormat: "ISO",
    fields: { transactionDate: "JournalDate", debit: "CashDR", credit: "CashCR", currency: "Currency", reference: "Voucher", description: "Memo" }, convention: "Cash asset debit is inflow; credit is outflow; unused side unavailable." },
  { id: "m2-bank-workbook", split: "train", role: "BANK", systemId: "synthetic-workbook-bank", accountId: "cash-workbook", basis: "AMOUNT_DIRECTION", dateBasis: "POSTING_DATE", format: "XLSX_STYLE", sourceDateFormat: "DMY",
    fields: { transactionDate: "Transaction Day", postingDate: "Posting Day", sourceAmount: "Movement Value", direction: "In/Out", currency: "Currency Code", reference: "Payment Ref", description: "Payment Details" }, convention: "Unsigned value with explicit in/out; posting-date basis and logical worksheet provenance." },
  { id: "m2-ledger-invoice", split: "train", role: "LEDGER", systemId: "synthetic-payables", accountId: "settled-expense", basis: "EXPENSE_DEBIT_CREDIT", dateBasis: "POSTING_DATE", format: "CSV", sourceDateFormat: "DMY",
    fields: { transactionDate: "InvoiceDay", postingDate: "SettlementDay", debit: "PaidExpense", credit: "ExpenseRefund", reference: "InvoiceNo", counterparty: "Supplier", description: "InvoiceText", currency: "CCY" }, convention: "Settled expense view only: expense debit outflow, refund credit inflow; not a general cash rule." },
  { id: "m2-bank-abbreviated", split: "train", role: "BANK", systemId: "synthetic-merchant-bank", accountId: "cash-merchant", basis: "CASH_DEBIT_CREDIT", dateBasis: "TRANSACTION_DATE", format: "CSV", sourceDateFormat: "MDY",
    fields: { transactionDate: "TX_DT", debit: "CASH_IN", credit: "CASH_OUT", reference: "RRN", description: "MCH_ABBR", currency: "CUR" }, convention: "Explicit cash-in/cash-out columns; synthetic cash asset debit/credit interpretation; abbreviated merchant text." },
  { id: "m2-ledger-journal", split: "train", role: "LEDGER", systemId: "synthetic-signed-journal", accountId: "expense-journal", basis: "SIGNED_EXPENSE", dateBasis: "TRANSACTION_DATE", format: "JOURNAL_EXPORT", sourceDateFormat: "ISO",
    fields: { transactionDate: "DocumentDate", sourceAmount: "SignedExpense", description: "JournalNarration", reference: "DocumentId", currency: "LedgerCurrency" }, convention: "Restricted settled expense journal: positive paid expense/outflow, negative refund/inflow." },
  { id: "m2-bank-booking", split: "development", role: "BANK", systemId: "synthetic-booking-bank", accountId: "cash-booking", basis: "SIGNED_CASH", dateBasis: "POSTING_DATE", format: "CSV", sourceDateFormat: "DMY",
    fields: { transactionDate: "InitiatedOn", postingDate: "BookedOn", sourceAmount: "AccountDelta", reference: "BookingToken", description: "BookingText", currency: "ISO_Currency" }, convention: "Signed account delta; separate initiation/booking dates; booking governs canonical date." },
  { id: "m2-ledger-supplier", split: "development", role: "LEDGER", systemId: "synthetic-supplier-remittance", accountId: "supplier-cash", basis: "AMOUNT_DIRECTION", dateBasis: "POSTING_DATE", format: "JOURNAL_EXPORT", sourceDateFormat: "DMY",
    fields: { postingDate: "RemittanceDate", sourceAmount: "RemittedValue", direction: "CashMovement", reference: "SupplierPaymentId", counterparty: "Payee", description: "RemittanceAdvice", currency: "PaymentCCY" }, convention: "Unsigned supplier settlement and explicit cash movement; optional document date may be absent." },
  { id: "m2-bank-wallet", split: "heldout", role: "BANK", systemId: "synthetic-wallet-statement", accountId: "cash-wallet", basis: "AMOUNT_DIRECTION", dateBasis: "TRANSACTION_DATE", format: "CSV", sourceDateFormat: "ISO",
    fields: { transactionDate: "OccurredOn", sourceAmount: "GrossValue", direction: "WalletFlow", description: "MerchantLabel", reference: "TraceCode", currency: "Unit" }, convention: "Wallet gross value with explicit flow; sparse optional merchant/trace metadata." },
  { id: "m2-ledger-minimal", split: "heldout", role: "LEDGER", systemId: "synthetic-minimal-cashbook", accountId: "minimal-cash", basis: "SIGNED_CASH", dateBasis: "TRANSACTION_DATE", format: "CSV", sourceDateFormat: "MDY",
    fields: { transactionDate: "Date", sourceAmount: "CashChange", description: "Text", currency: "Unit" }, convention: "Minimal signed cash book: positive receipt, negative payment; optional references may be unavailable." },
  { id: "m2-bank-treasury", split: "heldout", role: "BANK", systemId: "synthetic-treasury-statement", accountId: "cash-treasury", basis: "SIGNED_CASH", dateBasis: "POSTING_DATE", format: "XLSX_STYLE", sourceDateFormat: "MDY",
    fields: { transactionDate: "TradeDate", postingDate: "SettlementDate", sourceAmount: "NetCashMovement", currency: "SettlementCurrency", reference: "TreasuryRef", description: "SettlementNarrative" }, convention: "Signed settled cash; separate trade/settlement dates, worksheet-style metadata." },
  { id: "m2-ledger-localized", split: "heldout", role: "LEDGER", systemId: "synthetic-localized-ledger", accountId: "localized-expense", basis: "EXPENSE_DEBIT_CREDIT", dateBasis: "POSTING_DATE", format: "JOURNAL_EXPORT", sourceDateFormat: "DMY",
    fields: { transactionDate: "TarikhDokumen", postingDate: "TarikhCatatan", debit: "BelanjaDibayar", credit: "PulanganBelanja", reference: "NoBaucar", description: "Butiran", currency: "MataWang" }, convention: "Paid expense debit is outflow; expense refund credit inflow; Malay field names and posting-date basis." },
];
export const BLOCKS = [
  { id: "train-a", split: "train", bank: "m2-bank-structured", ledger: "m2-ledger-cash", merchant: "Rimba Stationery" },
  { id: "train-b", split: "train", bank: "m2-bank-workbook", ledger: "m2-ledger-invoice", merchant: "Kencana Services" },
  { id: "train-c", split: "train", bank: "m2-bank-abbreviated", ledger: "m2-ledger-journal", merchant: "Meranti Traders" },
  { id: "development-a", split: "development", bank: "m2-bank-booking", ledger: "m2-ledger-supplier", merchant: "Teras Supplies" },
  { id: "heldout-a", split: "heldout", bank: "m2-bank-wallet", ledger: "m2-ledger-minimal", merchant: "Borneo Utilities" },
  { id: "heldout-b", split: "heldout", bank: "m2-bank-treasury", ledger: "m2-ledger-localized", merchant: "Samudera Workshop" },
] as const;
