import 'server-only';
export const VERSION = 'llm-reconciliation-suggestion/1' as const;
export interface Suggestion {
  bankId: string; ledgerId: string; bankReference: string; ledgerReference: string; rationale: string;
}
export interface SuggestionEnvelopeV1 {
  version: typeof VERSION; suggestions: Suggestion[];
  abstentions: Array<{recordId: string; reason: string}>;
}
const string = (maxLength: number) => ({type: 'string', minLength: 1, maxLength});
export const OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['version', 'suggestions', 'abstentions'],
  properties: {
    version: {type: 'string', const: VERSION},
    suggestions: {type: 'array', maxItems: 20, items: {
      type: 'object', additionalProperties: false,
      required: ['bankId','ledgerId','bankReference','ledgerReference','rationale'],
      properties: {bankId: string(128), ledgerId: string(128), bankReference: string(512),
        ledgerReference: string(512), rationale: string(512)},
    }},
    abstentions: {type: 'array', maxItems: 50, items: {
      type: 'object', additionalProperties: false, required: ['recordId','reason'],
      properties: {recordId: string(128), reason: string(512)},
    }},
  },
} as const;
function exact(value: unknown, names: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === names.length && Object.keys(value).every(k => names.includes(k));
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f]/u.test(value);
}
/** Reject duplicate JSON keys instead of silently accepting JSON.parse's last value. */
function uniqueKeys(raw: string) {
  const tokens = raw.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/gu) ?? [];
  const stack: Array<Set<string> | null> = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '{' || token === '[') {
      stack.push(token === '{' ? new Set() : null);
      if (stack.length > 16) throw new Error('JSON_DEPTH');
    } else if (token === '}' || token === ']') stack.pop();
    else if (token.startsWith('"') && tokens[i+1] === ':') {
      const keys = stack.at(-1), key = JSON.parse(token);
      if (keys?.has(key)) throw new Error('DUPLICATE_JSON_KEY');
      keys?.add(key);
    }
  }
}
export function parseSuggestion(raw: string): SuggestionEnvelopeV1 {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 16384) throw new Error('JSON_SIZE');
  const value: unknown = JSON.parse(raw); uniqueKeys(raw);
  if (!exact(value, ['version','suggestions','abstentions']) || value.version !== VERSION
    || !Array.isArray(value.suggestions) || value.suggestions.length > 20
    || !Array.isArray(value.abstentions) || value.abstentions.length > 50) throw new Error('JSON_SCHEMA');
  const used = new Set<string>();
  for (const s of value.suggestions) {
    if (!exact(s, ['bankId','ledgerId','bankReference','ledgerReference','rationale'])
      || !text(s.bankId,128) || !text(s.ledgerId,128) || !text(s.bankReference,512)
      || !text(s.ledgerReference,512) || !text(s.rationale,512)) throw new Error('SUGGESTION_SCHEMA');
    if (s.bankId === s.ledgerId || used.has(s.bankId) || used.has(s.ledgerId)) throw new Error('DUPLICATE_ASSIGNMENT');
    used.add(s.bankId); used.add(s.ledgerId);
  }
  for (const a of value.abstentions) {
    if (!exact(a, ['recordId','reason']) || !text(a.recordId,128) || !text(a.reason,512)) throw new Error('ABSTENTION_SCHEMA');
    if (used.has(a.recordId)) throw new Error('CONFLICTING_ABSTENTION');
    used.add(a.recordId);
  }
  return value as unknown as SuggestionEnvelopeV1;
}
