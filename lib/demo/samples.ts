import { sha256Hex, type DocumentInput } from './pipeline';

export const CANONICAL_SAMPLES = ['demo-bank-statement-2026-03.csv', 'demo-general-ledger-2026-03.csv', 'demo-bank-history-2025-04-to-2026-03.csv'] as const;
export const UNFAMILIAR_SAMPLES = ['unfamiliar/bank-statement-march-2026-export.csv', 'unfamiliar/general-ledger-cash-march-2026.csv', 'demo-bank-history-2025-04-to-2026-03.csv'] as const;
export const SAMPLE_ERROR = 'The synthetic sample documents could not be loaded or did not match their published fingerprints. No unverified sample files were processed.';
export type SamplePhase = 'Loading sample documents' | 'Verifying sample fingerprints';

/** Shared by Data selection and Overview onboarding. Never normalise downloaded bytes to pass a hash. */
export async function loadSampleDocuments(paths: readonly string[] = CANONICAL_SAMPLES, onPhase?: (phase: SamplePhase) => void, request: typeof fetch = fetch): Promise<DocumentInput[]> {
    onPhase?.('Loading sample documents');
    const locations = paths.map(path => {
        const split = path.lastIndexOf('/');
        return { path, dir: split < 0 ? '' : path.slice(0, split + 1), name: path.slice(split + 1) };
    });
    const manifests = new Map(await Promise.all([...new Set(locations.map(x => x.dir))].map(async dir => {
        const response = await request(`/demo/${dir}manifest.json`, { cache: 'no-store' });
        if (!response.ok) throw Error(SAMPLE_ERROR);
        const manifest = await response.json() as { files?: Record<string, { sha256?: string }> };
        return [dir, manifest.files] as const;
    })));
    const files = await Promise.all(locations.map(async file => {
        const response = await request(`/demo/${file.path}`, { cache: 'no-store' });
        if (!response.ok) throw Error(SAMPLE_ERROR);
        return { ...file, bytes: new Uint8Array(await response.arrayBuffer()) };
    }));
    onPhase?.('Verifying sample fingerprints');
    return Promise.all(files.map(async ({ dir, name, bytes }) => {
        const expected = manifests.get(dir)?.[name]?.sha256;
        if (!expected || !/^[a-f0-9]{64}$/.test(expected) || expected !== await sha256Hex(bytes)) throw Error(SAMPLE_ERROR);
        return { name, bytes, provenance: 'PUBLIC_SYNTHETIC_SAMPLE' as const };
    }));
}

/** One in-flight sample action; also recheck eligibility after the asynchronous download. */
export function createSampleAction({ allowed, process, load, onPhase, onBusy }: {
    allowed: () => boolean; process: (files: DocumentInput[]) => Promise<unknown>;
    load?: () => Promise<DocumentInput[]>; onPhase?: (phase: SamplePhase) => void; onBusy?: (busy: boolean) => void;
}) {
    let running = false;
    return async () => {
        if (running || !allowed()) return;
        running = true;
        onBusy?.(true);
        try {
            const files = await (load ? load() : loadSampleDocuments(CANONICAL_SAMPLES, onPhase));
            if (allowed()) await process(files);
        } finally { running = false; onBusy?.(false); }
    };
}
