// The one place that defines which characters are unsafe in record text (R1.4) and how attacker-controlled text is
// echoed in diagnostics (R1.8). Pure: imports nothing from this module's siblings.

// Control characters are C0 (includes \t \n \r), DEL and C1 (includes U+0085). U+2028/U+2029 are line breaks but not controls.
export const CONTROL_CLASS = '\\u0000-\\u001f\\u007f-\\u009f';
const SINGLE_LINE_UNSAFE = new RegExp(`[${CONTROL_CLASS}\\u2028\\u2029]`);
const SINGLE_LINE_UNSAFE_ALL = new RegExp(SINGLE_LINE_UNSAFE.source, 'g');
const MULTILINE_UNSAFE = new RegExp(`[${CONTROL_CLASS}]`);

/** Stand-in returned by the escaping and clipping helpers for non-string input (they never throw). */
export const NON_STRING = '<non-string>';
export const MAX_MESSAGE = 300;
const MAX_ECHO_CODE_POINTS = 80;
const MAX_ECHO_ESCAPED = 240;

/** A string with no line break and no control character. */
export const isSingleLine = (text: unknown): text is string => typeof text === 'string' && !SINGLE_LINE_UNSAFE.test(text);
/** A string whose only control characters are `\n` and `\t`. */
export const isSafeMultiline = (text: unknown): text is string => typeof text === 'string' && !MULTILINE_UNSAFE.test(text.replace(/[\n\t]/g, ''));

const unicodeEscape = (c: string): string => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;

/** JSON-string escaping (without the quotes) plus the line breaks and controls JSON leaves alone. Does not clip. */
export function escapeText(text: string): string {
    if (typeof text !== 'string') return NON_STRING;
    return JSON.stringify(text).slice(1, -1).replace(SINGLE_LINE_UNSAFE_ALL, unicodeEscape);
}

/** Cuts at `maxUnits` UTF-16 units, dropping a trailing high surrogate so a pair is never split. The only cut of untrusted text by unit count. */
export function sliceNoSplit(text: string, maxUnits: number): string {
    // Non-string text, or a limit that is not a finite number of at least 1, yields '' (never throws); fractions are floored.
    if (typeof text !== 'string' || typeof maxUnits !== 'number' || !Number.isFinite(maxUnits)) return '';
    const limit = Math.floor(maxUnits);
    if (limit < 1) return '';
    if (text.length <= limit) return text;
    const last = text.charCodeAt(limit - 1);
    return text.slice(0, last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit);
}

/** Attacker-controlled text made safe to embed in a diagnostic: bounded, JSON-escaped, never containing a raw line break or control. */
export function esc(text: string): string {
    if (typeof text !== 'string') return NON_STRING;
    const points = [...text];
    const clipped = points.length > MAX_ECHO_CODE_POINTS ? `${points.slice(0, MAX_ECHO_CODE_POINTS).join('')}…` : text;
    const escaped = escapeText(clipped);
    return escaped.length > MAX_ECHO_ESCAPED ? `${sliceNoSplit(escaped, MAX_ECHO_ESCAPED)}…` : escaped;
}

/** Escapes any remaining raw line break or control character (no quoting, no clipping). */
export const cleanText = (text: string): string => (typeof text === 'string' ? text.replace(SINGLE_LINE_UNSAFE_ALL, unicodeEscape) : NON_STRING);

/** Clips to MAX_MESSAGE UTF-16 units including the ellipsis. */
export function clipMessage(message: string): string {
    if (typeof message !== 'string') return NON_STRING;
    return message.length <= MAX_MESSAGE ? message : `${sliceNoSplit(message, MAX_MESSAGE - 1)}…`;
}
