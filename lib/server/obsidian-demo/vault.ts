import 'server-only';
import { lstat, mkdir, readFile, realpath, readdir, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';

const DEFAULT_VAULT = 'obsidian-demo-vault';
const MAX_FILES = 200;
const MAX_NOTE_BYTES = 256 * 1024;
export const MIN_PASSAGE_SCORE = 0.5;
export const MAX_RESULTS = 3;
const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'of', 'on', 'our', 'the', 'to', 'was', 'we', 'what', 'were', 'with', 'you']);

export type VaultPassage = { title: string; heading: string; snippet: string; link: string; score: number };
export type GeneratedVaultNote = { processingId: string; period: string; currency: string; sourceHashes: string[]; noteTitle: string; relativePath: string };

function inside(root: string, target: string): boolean {
    const rel = relative(root, target);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function loopback(hostname: string): boolean { return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'; }

export function obsidianDemoModeEnabled(): boolean {
    return process.env.NODE_ENV === 'development' && !process.env.VERCEL && process.env.FINGENCE_OBSIDIAN_DEMO === '1'
        && !['FINGENCE_POC_LOCAL', 'FINGENCE_M2_LOCAL', 'FINGENCE_M3_LOCAL', 'FINGENCE_M4_LOCAL', 'FINGENCE_M5_LOCAL'].some(k => process.env[k] === '1');
}

/** All vault access is local-development-only, explicitly enabled, and prohibited in the signed-in POC runtime. */
export function assertObsidianDemoAccess(request: Request): void {
    if (!obsidianDemoModeEnabled()) {
        throw new Error('OBSIDIAN_DEMO_DISABLED');
    }
    let url: URL, origin: URL;
    try {
        url = new URL(request.url);
        const host = request.headers.get('host');
        if (!host) throw new Error();
        origin = new URL(`${url.protocol}//${host}`);
    } catch { throw new Error('OBSIDIAN_DEMO_LOOPBACK_REQUIRED'); }
    if (!loopback(url.hostname) || !loopback(origin.hostname) || origin.port !== url.port
        || (request.headers.get('origin') && request.headers.get('origin') !== origin.origin)
        || request.headers.get('sec-fetch-site') === 'cross-site') throw new Error('OBSIDIAN_DEMO_LOOPBACK_REQUIRED');
}

async function localDataRoot(create: boolean): Promise<{ lexical: string; real: string }> {
    const projectRoot = await realpath(process.cwd());
    const lexical = resolve(projectRoot, '.local');
    try {
        const stat = await lstat(lexical);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('OBSIDIAN_LOCAL_PATH_INVALID');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) throw new Error('OBSIDIAN_LOCAL_PATH_INVALID');
        await mkdir(lexical, { mode: 0o700 });
    }
    const real = await realpath(lexical);
    if (!inside(projectRoot, real) || real === projectRoot) throw new Error('OBSIDIAN_LOCAL_PATH_INVALID');
    return { lexical, real };
}

/** Relative settings are resolved under .local; absolute settings are accepted only inside that ignored directory. */
export async function obsidianVaultRoot(options: { create?: boolean } = {}): Promise<{ lexical: string; real: string }> {
    const local = await localDataRoot(options.create ?? false);
    const raw = process.env.FINGENCE_OBSIDIAN_VAULT_PATH || DEFAULT_VAULT;
    const parts = raw.split(/[\\/]+/).filter(Boolean);
    if (!raw.trim() || parts.includes('..')) throw new Error('OBSIDIAN_VAULT_PATH_INVALID');
    const candidate = isAbsolute(raw) ? resolve(raw) : resolve(local.lexical, raw);
    if (candidate === local.lexical || !inside(local.lexical, candidate)) throw new Error('OBSIDIAN_VAULT_PATH_INVALID');
    if (options.create) {
        const rel = relative(local.lexical, candidate).split(sep).filter(Boolean);
        let current = local.lexical;
        for (const part of rel) {
            current = resolve(current, part);
            try {
                const stat = await lstat(current);
                if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('OBSIDIAN_VAULT_PATH_INVALID');
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('OBSIDIAN_VAULT_PATH_INVALID');
                await mkdir(current, { mode: 0o700 });
            }
        }
    }
    let real: string;
    try { real = await realpath(candidate); } catch { throw new Error('OBSIDIAN_VAULT_UNAVAILABLE'); }
    if (real === local.real || !inside(local.real, real)) throw new Error('OBSIDIAN_VAULT_PATH_INVALID');
    return { lexical: candidate, real };
}

/** Resolves one note path only; paths supplied by a caller can never select the vault root or leave it. */
export async function resolveVaultMarkdownPath(vaultRealPath: string, notePath: string): Promise<string> {
    if (typeof notePath !== 'string' || !notePath || isAbsolute(notePath)
        || notePath.split(/[\\/]+/).some(part => part === '..') || extname(notePath).toLowerCase() !== '.md') {
        throw new Error('OBSIDIAN_NOTE_PATH_INVALID');
    }
    const candidate = resolve(vaultRealPath, notePath);
    if (candidate === vaultRealPath || !inside(vaultRealPath, candidate)) throw new Error('OBSIDIAN_NOTE_PATH_INVALID');
    let real: string;
    try { real = await realpath(candidate); } catch { throw new Error('OBSIDIAN_NOTE_UNAVAILABLE'); }
    if (!inside(vaultRealPath, real) || !(await lstat(real)).isFile()) throw new Error('OBSIDIAN_NOTE_PATH_INVALID');
    return real;
}

async function markdownFiles(vaultRoot: string): Promise<string[]> {
    const rootStat = await lstat(vaultRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('OBSIDIAN_VAULT_PATH_INVALID');
    const realRoot = await realpath(vaultRoot), found: string[] = [], visited = new Set<string>();
    async function walk(dir: string, depth: number): Promise<void> {
        const realDir = await realpath(dir);
        if (!inside(realRoot, realDir)) throw new Error('OBSIDIAN_SYMLINK_ESCAPE');
        if (visited.has(realDir)) return;
        visited.add(realDir);
        if (depth > 8) throw new Error('OBSIDIAN_VAULT_TOO_DEEP');
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            if (entry.name === '.obsidian') continue;
            const relativeName = relative(realRoot, resolve(dir, entry.name));
            const candidateReal = await realpath(resolve(dir, entry.name));
            if (!inside(realRoot, candidateReal)) throw new Error('OBSIDIAN_SYMLINK_ESCAPE');
            const stat = await lstat(resolve(dir, entry.name));
            if (stat.isSymbolicLink()) {
                const target = await lstat(candidateReal);
                if (target.isDirectory()) await walk(candidateReal, depth + 1);
                else if (target.isFile() && extname(entry.name).toLowerCase() === '.md') found.push(relativeName);
            } else if (entry.isDirectory()) await walk(resolve(dir, entry.name), depth + 1);
            else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') found.push(relativeName);
            if (found.length > MAX_FILES) throw new Error('OBSIDIAN_VAULT_TOO_LARGE');
        }
    }
    await walk(vaultRoot, 0);
    return [...new Set(found)].sort();
}

type PassageDoc = { title: string; heading: string; body: string; metadata: string; link: string };
function parseSections(notePath: string, markdown: string): PassageDoc[] {
    const title = markdown.match(/^#\s+(.+)\s*$/m)?.[1]?.trim() ?? notePath.replace(/\.md$/i, '').split(/[\\/]/).at(-1)!;
    const firstSection = markdown.search(/^##\s+.+$/m);
    if (firstSection < 0) return [];
    const metadata = markdown.slice(0, firstSection).replace(/^---\s*$[\s\S]*?^---\s*$/m, '').trim();
    const tail = markdown.slice(firstSection), sections = tail.split(/(?=^##\s+.+$)/m), docs: PassageDoc[] = [];
    for (const section of sections) {
        const match = section.match(/^##\s+(.+)\s*\n([\s\S]*)$/);
        if (!match) continue;
        const heading = match[1].trim(), body = match[2].trim();
        if (!body) continue;
        docs.push({ title, heading, body, metadata, link: `[[${title}#${heading}]]` });
    }
    return docs;
}

function terms(text: string): string[] {
    return text.normalize('NFKD').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(t => t.length > 1 && !STOP_WORDS.has(t)) ?? [];
}

function bm25(query: string, docs: PassageDoc[]): Array<{ doc: PassageDoc; score: number }> {
    const queryTerms = [...new Set(terms(query))];
    if (!queryTerms.length || !docs.length) return [];
    const tokenized = docs.map(d => terms(`${d.title} ${d.heading} ${d.metadata} ${d.body}`));
    const averageLength = tokenized.reduce((n, d) => n + d.length, 0) / tokenized.length || 1;
    const documentFrequency = new Map<string, number>();
    for (const tokens of tokenized) for (const term of new Set(tokens)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    const scored = docs.map((doc, i) => {
        const tokens = tokenized[i], frequencies = new Map<string, number>();
        for (const term of tokens) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
        let score = 0;
        for (const term of queryTerms) {
            const tf = frequencies.get(term) ?? 0, df = documentFrequency.get(term) ?? 0;
            if (!tf) continue;
            const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
            score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * tokens.length / averageLength));
            if (terms(doc.title).includes(term)) score += idf * 0.4;
            if (terms(doc.heading).includes(term)) score += idf * 0.8;
        }
        return { doc, score };
    });
    return scored.filter(s => s.score >= MIN_PASSAGE_SCORE).sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title) || a.doc.heading.localeCompare(b.doc.heading)).slice(0, MAX_RESULTS);
}

/** Reads only local Markdown passages. It returns ranked passages, never a directory listing or raw file bytes. */
export async function retrieveObsidianPassages(request: Request, query: string): Promise<VaultPassage[]> {
    assertObsidianDemoAccess(request);
    if (typeof query !== 'string' || !query.trim() || query.length > 300) throw new Error('OBSIDIAN_QUERY_INVALID');
    const root = await obsidianVaultRoot();
    const paths = await markdownFiles(root.real), passages: PassageDoc[] = [];
    if (process.env.FINGENCE_OBSIDIAN_SYNTHETIC_ONLY === '1') {
        if (paths.length !== 1 || !/^FinGence Synthetic Finance Summary - \d{4}-\d{2}\.md$/.test(paths[0])) throw new Error('OBSIDIAN_SYNTHETIC_VAULT_REQUIRED');
        const onlyPath = await resolveVaultMarkdownPath(root.real, paths[0]);
        const onlyNote = await readFile(onlyPath, 'utf8');
        if (!/^data_classification:\s*synthetic\s*$/m.test(onlyNote)) throw new Error('OBSIDIAN_SYNTHETIC_VAULT_REQUIRED');
    }
    for (const path of paths) {
        const absolute = await resolveVaultMarkdownPath(root.real, path);
        const stat = await lstat(absolute);
        if (stat.size > MAX_NOTE_BYTES) throw new Error('OBSIDIAN_NOTE_TOO_LARGE');
        const markdown = await readFile(absolute, 'utf8');
        passages.push(...parseSections(path, markdown));
    }
    return bm25(query, passages).map(({ doc, score }) => ({
        title: doc.title, heading: doc.heading,
        snippet: doc.body.replace(/\s+/g, ' ').slice(0, 360),
        link: doc.link, score: Number(score.toFixed(4)),
    }));
}

export async function writeSyntheticSummaryNote(request: Request, markdown: string, metadata: Omit<GeneratedVaultNote, 'noteTitle' | 'relativePath'>): Promise<GeneratedVaultNote> {
    assertObsidianDemoAccess(request);
    const root = await obsidianVaultRoot({ create: true });
    const periodToken = metadata.period.replace(/[^0-9-]/g, '-');
    const noteTitle = `FinGence Synthetic Finance Summary - ${periodToken}`;
    const relativePath = `${noteTitle}.md`;
    const target = await resolveVaultWritePath(root, relativePath);
    const existing = await lstat(target).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : Promise.reject(error));
    if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw new Error('OBSIDIAN_NOTE_PATH_INVALID');
    await writeFile(target, markdown, { encoding: 'utf8', mode: 0o600, flag: 'w' });
    return { ...metadata, noteTitle, relativePath };
}

async function resolveVaultWritePath(root: { lexical: string; real: string }, notePath: string): Promise<string> {
    if (isAbsolute(notePath) || notePath.split(/[\\/]+/).some(part => part === '..') || extname(notePath).toLowerCase() !== '.md') throw new Error('OBSIDIAN_NOTE_PATH_INVALID');
    const target = resolve(root.lexical, notePath);
    if (target === root.lexical || !inside(root.lexical, target)) throw new Error('OBSIDIAN_NOTE_PATH_INVALID');
    const parent = await realpath(resolve(target, '..'));
    if (!inside(root.real, parent)) throw new Error('OBSIDIAN_SYMLINK_ESCAPE');
    return target;
}
