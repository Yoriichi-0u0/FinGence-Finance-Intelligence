import type { Check, Quarantined } from '../demo/pipeline';

/**
 * Experimental local OCR feasibility contracts (Xiaomi-OCR-0 PoC). Not a C1, V2 or backend contract.
 * A model transcription is a proposal only. Coordinates always come from an independent reader;
 * a value that cannot be anchored to the original document is held as unresolved, never accepted.
 */
export const OCR_PROPOSAL_VERSION = 'poc-ocr-proposal-0.1' as const;
export const OCR_EVIDENCE_VERSION = 'poc-ocr-evidence-0.1' as const;
export const OCR_VERIFICATION_VERSION = 'poc-ocr-verification-0.1' as const;

/** How the proposal was produced. RECORDED_TEST replays stored model output; it is never presented as a live run. */
export type OcrProposalMode = 'LOCAL_MODEL_PROPOSAL' | 'RECORDED_TEST';
export type OcrReceipt = {
    /** `docling-02-baseline` replays the existing reader through the same gates for comparison only. */
    mode: OcrProposalMode; engine: 'xiaomi-ocr-0' | 'docling-02-baseline'; modelRevision: string; weightsSha256: string; promptSha256: string;
    device: string; runtime: string;
};
export type OcrProposalPage = { page: number; imageSha256: string; responseSha256: string; truncated: boolean; tables: string[][][]; texts: string[] };
export type OcrProposal = { version: typeof OCR_PROPOSAL_VERSION; sourceSha256: string; filename: string; receipt: OcrReceipt; pages: OcrProposalPage[] };

/** A text region from an independent reader (Docling or RapidOCR) with real page coordinates. */
export type AnchorRegion = {
    text: string; box: [number, number, number, number]; width: number; height: number;
    coordinateSystem: 'TOP_LEFT_POINTS' | 'TOP_LEFT_PIXELS'; rowKey: string | null;
};
export type AnchorReader = 'docling-02' | 'rapidocr' | 'rapidocr-x2';
export type AnchorSet = { reader: AnchorReader; sourceSha256: string; pages: { page: number; regions: AnchorRegion[] }[] };

/** Same item shape as the V2 worker output (`workerEvidenceSchema`), plus a stable identity. */
export type OcrEvidenceItem = {
    id: string; value: string; text: string; page: number; sheet: null; row: number; column: string; address: null;
    box: [number, number, number, number] | null; width: number | null; height: number | null;
    coordinateSystem: AnchorRegion['coordinateSystem'] | null; table: string; header: boolean; confidence: null; method: string;
};
export type RowKind = 'HEADER' | 'TRANSACTION' | 'BALANCE_FORWARD' | 'SUMMARY' | 'OTHER';
export type OcrRow = { page: number; table: string; index: number; kind: RowKind; cells: Record<string, string>; itemIds: string[] };
export type UnanchoredCell = { itemId: string; page: number; column: string; text: string; reason: 'NO_INDEPENDENT_MATCH' | 'AMBIGUOUS_MATCH' | 'ROW_KEY_UNANCHORED' | 'HEADER_UNANCHORED' | 'COLUMN_MISMATCH' | 'COLUMN_CONFLICT' | 'COLUMN_GROUP_UNRESOLVED' };
export type OcrEvidence = {
    version: typeof OCR_EVIDENCE_VERSION; sourceSha256: string; filename: string; receipt: OcrReceipt; anchorReaders: AnchorReader[];
    items: OcrEvidenceItem[]; rows: OcrRow[]; unanchored: UnanchoredCell[]; texts: { page: number; text: string }[];
    /** Independent-reader regions no transcribed cell claimed: content the model may have omitted. */
    unclaimed: { page: number; text: string }[];
    coverage: 'TABLE_ROWS' | 'REGIONS_ONLY'; warnings: string[];
};

export type OcrDirection = 'BANK_DEBIT' | 'BANK_CREDIT';
/** Machine-verified experimental statement line. Bank perspective: a bank debit removes cash. Not a CanonicalTransaction. */
export type OcrVerifiedRecord = {
    id: string; page: number; printedDate: string; isoDate: string; reference: string; description: string;
    direction: OcrDirection; amount: string; balance: string; evidenceIds: string[];
};
export type OcrHeldRecord = { id: string; page: number; reference: string | null; reasons: string[]; evidenceIds: string[] };
export type OcrVerification = {
    version: typeof OCR_VERIFICATION_VERSION; proposalMode: OcrProposalMode; anchorReaders: AnchorReader[];
    decision: 'VERIFIED' | 'PARTIAL' | 'QUARANTINED'; checks: Check[];
    accepted: OcrVerifiedRecord[]; quarantined: OcrHeldRecord[]; unresolved: OcrHeldRecord[]; quarantine: Quarantined[];
    controlTotals: { printed: Record<string, string>; computed: Record<string, string> };
};
