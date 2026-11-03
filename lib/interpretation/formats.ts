/** Strict, model-independent parsers for the declared date and number formats. Exact cents only. */
import type { DATE_FORMATS, NUMBER_FORMATS } from './contracts';

export type DateFormat = typeof DATE_FORMATS[number];
export type NumberFormat = typeof NUMBER_FORMATS[number];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Malay abbreviations that differ from English (Mac = March, Mei = May, Ogos = August, Okt = October, Dis = December).
const MALAY: Record<string, number> = { mac: 3, mei: 5, ogo: 8, okt: 10, dis: 12 };

function iso(y: number, m: number, d: number): string | null {
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const value = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const date = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
const month = (name: string) => { const k = name.toLowerCase().slice(0, 3); const i = MONTHS.indexOf(k); return i >= 0 ? i + 1 : MALAY[k] ?? 0; };

/** Returns an ISO date or null when the literal does not strictly match the format. */
export function parseDate(literal: string, format: DateFormat): string | null {
    const v = literal.trim();
    let m: RegExpExecArray | null;
    switch (format) {
        case 'YYYY-MM-DD': return (m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)) ? iso(+m[1], +m[2], +m[3]) : null;
        case 'DD/MM/YYYY': return (m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v)) ? iso(+m[3], +m[2], +m[1]) : null;
        case 'MM/DD/YYYY': return (m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v)) ? iso(+m[3], +m[1], +m[2]) : null;
        case 'DD-MM-YYYY': return (m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(v)) ? iso(+m[3], +m[2], +m[1]) : null;
        case 'DD.MM.YYYY': return (m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v)) ? iso(+m[3], +m[2], +m[1]) : null;
        case 'DD-Mon-YYYY': return (m = /^(\d{1,2})-([A-Za-z]{3,9})-(\d{4})$/.exec(v)) && month(m[2]) ? iso(+m[3], month(m[2]), +m[1]) : null;
        case 'D Mon YYYY': return (m = /^(\d{1,2}) ([A-Za-z]{3,9}) (\d{4})$/.exec(v)) && month(m[2]) ? iso(+m[3], month(m[2]), +m[1]) : null;
        case 'YYYYMMDD': return (m = /^(\d{4})(\d{2})(\d{2})$/.exec(v)) ? iso(+m[1], +m[2], +m[3]) : null;
    }
}
/** The day/month-swapped reading of a numeric format, used to prove a declared date order is not ambiguous. */
export const SWAPPED: Partial<Record<DateFormat, DateFormat>> = { 'DD/MM/YYYY': 'MM/DD/YYYY', 'MM/DD/YYYY': 'DD/MM/YYYY' };

const PATTERNS: Record<NumberFormat, { re: RegExp; group: string; decimal: string }> = {
    PLAIN: { re: /^\d{1,13}(?:\.\d{1,2})?$/, group: '', decimal: '.' },
    COMMA_THOUSANDS_DOT_DECIMAL: { re: /^(?:\d{1,3}(?:,\d{3})+|\d{1,13})(?:\.\d{1,2})?$/, group: ',', decimal: '.' },
    DOT_THOUSANDS_COMMA_DECIMAL: { re: /^(?:\d{1,3}(?:\.\d{3})+|\d{1,13})(?:,\d{1,2})?$/, group: '.', decimal: ',' },
};
/** Exact cents; `undefined` for an empty cell, `null` when the literal is not valid in this format. */
export function parseAmount(literal: string, format: NumberFormat): bigint | null | undefined {
    let v = literal.trim().replace(/^(?:RM|MYR)\s*/i, '');
    if (!v || v === '-') return undefined;
    let negative = false;
    if (/^\(.*\)$/.test(v)) { negative = true; v = v.slice(1, -1).trim(); }
    if (v.startsWith('-')) { negative = !negative; v = v.slice(1).trim(); }
    else if (v.startsWith('+')) v = v.slice(1).trim();
    const p = PATTERNS[format];
    if (!p.re.test(v)) return null;
    const [whole, fraction = ''] = (p.group ? v.split(p.group).join('') : v).split(p.decimal);
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
    return negative ? -cents : cents;
}
export const NUMBER_FORMAT_LIST: NumberFormat[] = ['PLAIN', 'COMMA_THOUSANDS_DOT_DECIMAL', 'DOT_THOUSANDS_COMMA_DECIMAL'];
export function cents(value: bigint): string {
    const digits = (value < 0n ? -value : value).toString().padStart(3, '0');
    return (value < 0n ? '-' : '') + digits.slice(0, -2) + '.' + digits.slice(-2);
}
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MALAY_MONTH_NAMES = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];
