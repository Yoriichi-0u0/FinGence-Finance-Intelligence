import 'server-only';

/** Request bounds shared by every public AI gateway route. Each check runs before any provider call. */
export const noStoreJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Same-origin browser requests only. A missing, opaque ("null") or unparsable Origin is refused, never thrown on. */
export function sameOrigin(headers: Headers) {
    const origin = headers.get('origin'), host = headers.get('host'), site = headers.get('sec-fetch-site');
    if (!origin || !host || (site && site !== 'same-origin')) return false;
    if (!URL.canParse(origin)) return false;
    const url = new URL(origin);
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.host === host.toLowerCase();
}

/** Reads at most `max` bytes: a declared length is checked first, then the stream is counted and cancelled once over. */
export async function readBounded(request: Request, max: number): Promise<string | 'TOO_LARGE' | 'INVALID'> {
    const declared = request.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) return 'TOO_LARGE';
    if (!request.body) return '';
    const reader = request.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) { await reader.cancel().catch(() => undefined); return 'TOO_LARGE'; }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return 'INVALID'; }
}

/** Origin, content type, bounded body and JSON, in that order; returns the parsed body or the refusal response. */
export async function boundedJson(request: Request, max: number): Promise<{ body: unknown } | { refusal: Response }> {
    if (!sameOrigin(request.headers)) return { refusal: noStoreJson({ code: 'CROSS_ORIGIN' }, 403) };
    if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return { refusal: noStoreJson({ code: 'JSON_REQUIRED' }, 415) };
    const text = await readBounded(request, max);
    if (text === 'TOO_LARGE') return { refusal: noStoreJson({ code: 'TOO_LARGE' }, 413) };
    let body: unknown;
    try { body = text === 'INVALID' ? undefined : JSON.parse(text); } catch { body = undefined; }
    return body === undefined ? { refusal: noStoreJson({ code: 'INVALID_JSON' }, 400) } : { body };
}
