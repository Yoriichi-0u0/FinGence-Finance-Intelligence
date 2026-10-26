import type { DocumentKind } from "../../../ai-ingestion/increment-02/contracts";
export interface ReplayCase { id: string; file: string; family: string; documentKind: DocumentKind; dateOrder: "ISO" | "DMY" | "MDY"; numberFormat: "plain" | "dot_comma" | "comma_dot" }
// These are hand-authored TEST proposal settings, not model output or evaluation truth.
const files = ["bank-narrative.csv", "bank-narrative.xlsx", "ledger-dmy.csv", "ledger-dmy.xlsx", "bank-direction.csv", "bank-direction.xlsx", "metadata.csv", "metadata.xlsx", "bank-movements.csv", "bank-movements.pdf", "invoice.xlsx", "invoice.pdf", "receipt.pdf", "receipt-photo.png", "ambiguous.csv", "ambiguous.xlsx", "unknown-fee.csv", "unknown-fee.png", "precision.csv", "precision.pdf", "scan-bank.pdf", "mixed-bank.pdf", "low-quality.png", "low-quality.jpg", "corrupt.pdf", "validation-errors.csv"];
export const replayCases: ReplayCase[] = files.map(file => {
  const stem = file.replace(/\.[^.]+$/, ""); const family = ["scan-bank", "mixed-bank"].includes(stem) ? "bank-narrative" : stem === "receipt-photo" ? "receipt" : stem;
  const documentKind: DocumentKind = family.startsWith("bank-") || family === "precision" ? "BANK_STATEMENT" : family === "ledger-dmy" ? "GENERAL_LEDGER" : family === "invoice" ? "INVOICE" : family === "receipt" ? "RECEIPT" : ["low-quality", "corrupt"].includes(family) ? "UNKNOWN" : "TRANSACTION_TABLE";
  return { id: file, file, family, documentKind, dateOrder: family === "ledger-dmy" ? "DMY" : "ISO", numberFormat: "plain" };
});
