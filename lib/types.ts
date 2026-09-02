export type TransactionStatus =
  | "Matched"
  | "Suggested"
  | "Unmatched"
  | "Anomaly"
  | "Review";

export type TransactionSource = "Bank" | "Ledger";

export type Transaction = {
  id: string;
  date: string;
  description: string;
  reference: string;
  category: string;
  account: string;
  amount: number;
  source: TransactionSource;
  status: TransactionStatus;
  note: string;
};

export type RiskLevel = "High" | "Medium";
export type AnomalyStatus = "Open" | "Reviewed" | "Investigating" | "Dismissed";

export type Anomaly = {
  id: string;
  date: string;
  transaction: string;
  category: string;
  amount: number;
  score: number;
  risk: RiskLevel;
  status: AnomalyStatus;
  reasons: string[];
  historicalAverage: number;
};

export type ReconciliationRecord = {
  id: string;
  confidence: number;
  classification: "Automatic Match" | "Suggested Match" | "Manual Review";
  ledger: {
    date: string;
    description: string;
    reference: string;
    amount: number;
  };
  bank: {
    date: string;
    description: string;
    reference: string;
    amount: number;
  };
  factors: {
    amount: number;
    date: number;
    description: number;
    reference: number;
  };
  explanation: string;
  resolution: "Pending" | "Confirmed" | "Rejected";
};

export type UploadSource = "Ledger" | "Bank Statement" | "Budget";
export type UploadStage = "Uploading" | "Validating" | "Normalizing" | "Complete";
