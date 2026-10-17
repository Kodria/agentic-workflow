import { NON_STRING, cleanText, sliceNoSplit } from './text-safety';

// Pure text and number parsing of `awm changes list`: no git, no I/O, nothing throws. Shared by the reader (list.ts), the
// renderings (render-list.ts) and the command.

/**
 * Untrusted text as one clean line of at most `max` UTF-16 units: controls, line breaks and bidi marks escaped, an ellipsis
 * where it was cut, a surrogate pair never split. Never throws.
 */
export function cleanLine(text: unknown, max: number): string {
    if (typeof text !== 'string') return NON_STRING;
    const raw = sliceNoSplit(text, max);
    let out = cleanText(raw);
    if (raw.length < text.length || out.length > max) out = `${out.length > max - 1 ? sliceNoSplit(out, max - 1) : out}…`;
    return out;
}

const RELATIVE = /^(\d{1,9})([hd])$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SINCE_TEXT = 16;

/** `<n>h` or `<n>d` (n of 1 to 9 digits, at least 1, the result a valid date) or a calendar date `YYYY-MM-DD`; null for anything else. Never throws. */
export function parseSince(value: unknown, now: unknown): Date | null {
    if (typeof value !== 'string' || value.length > MAX_SINCE_TEXT || !(now instanceof Date)) return null;
    const nowMs = now.getTime();
    if (!Number.isFinite(nowMs)) return null;
    const rel = RELATIVE.exec(value);
    if (rel) {
        const n = Number(rel[1]);
        const hours = rel[2] === 'h';
        if (n < 1) return null;
        const since = new Date(nowMs - n * (hours ? 3600e3 : 86400e3));
        return Number.isNaN(since.getTime()) ? null : since;
    }
    if (ISO_DATE.test(value)) {
        const since = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(since.getTime()) && since.toISOString().slice(0, 10) === value ? since : null;
    }
    return null;
}

/** The number of a trailing `(#<n>)`; null when there is none or n is not a safe integer. Index scans only. */
export function parsePr(subject: string): number | null {
    if (typeof subject !== 'string') return null;
    let end = subject.length;
    while (end > 0 && (subject[end - 1] === ' ' || subject[end - 1] === '\t' || subject[end - 1] === '\r' || subject[end - 1] === '\n')) end--;
    if (end < 4 || subject[end - 1] !== ')') return null;
    const open = subject.lastIndexOf('(#', end - 1);
    if (open < 0) return null;
    const digits = subject.slice(open + 2, end - 1);
    if (digits.length === 0 || digits.length > 16) return null;
    for (let i = 0; i < digits.length; i++) if (digits[i] < '0' || digits[i] > '9') return null;
    const n = Number(digits);
    return Number.isSafeInteger(n) ? n : null;
}
