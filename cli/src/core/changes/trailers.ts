import { LOG_SAFETY_ARGS, isSafeRevision, runGit } from './git';

const OPT_OUT_TRAILER = 'Change-Record';

// Raw messages (%B), NUL-terminated by -z: a message cannot contain NUL, so one commit is exactly one record. Git's own
// %(trailers) is not used: it honours trailer.separators and trailer.<token>.key from the user's config, so what counts as
// an opt-out would differ per machine. Messages are untrusted and unbounded, so everything below is an index scan: no regex
// that can backtrack over a long run of blanks.
const FORMAT = '--format=%B';
const KEY = `${OPT_OUT_TRAILER}:`.toLowerCase();
const VALUE = 'none';
const COUNT_RE = /^-\d{1,4}$/;
const MAX_ARGS = 16;

const isBlank = (c: string): boolean => c === ' ' || c === '\t';

/** True when every character of `line` is a space, tab or CR (a blank line separating paragraphs). */
function isBlankLine(line: string): boolean {
    for (let i = 0; i < line.length; i++) if (!isBlank(line[i]) && line[i] !== '\r') return false;
    return true;
}

/** `Change-Record:` + optional spaces/tabs + `none` + optional spaces/tabs (+ the CR of a CRLF), key and value case-insensitive. */
function isOptOutLine(line: string): boolean {
    let end = line.length;
    if (end > 0 && line[end - 1] === '\r') end--;
    if (end < KEY.length + VALUE.length || line.slice(0, KEY.length).toLowerCase() !== KEY) return false;
    let i = KEY.length;
    while (i < end && isBlank(line[i])) i++;
    if (line.slice(i, i + VALUE.length).toLowerCase() !== VALUE) return false;
    i += VALUE.length;
    while (i < end && isBlank(line[i])) i++;
    return i === end;
}

/** DD-6: a line of the final paragraph (never the subject's) that is exactly `Change-Record: none`. No folding, no other separator. */
function optsOut(message: string): boolean {
    const lines = message.split('\n');
    let paragraphs = 0; let start = 0; let inside = false;
    for (let i = 0; i < lines.length; i++) {
        if (isBlankLine(lines[i])) inside = false;
        else if (!inside) { inside = true; start = i; paragraphs++; }
    }
    if (paragraphs < 2) return false;
    for (let i = start; i < lines.length; i++) if (isOptOutLine(lines[i])) return true;
    return false;
}

/**
 * True when any commit selected by `revArgs` (e.g. ['a..b'] or ['-1', sha]) carries `Change-Record: none`.
 * Only a commit count (`-N`) and safe revisions are accepted; anything else, and any git failure, is `false`.
 */
export function hasOptOut(root: string, revArgs: string[]): boolean {
    if (!Array.isArray(revArgs) || revArgs.length === 0 || revArgs.length > MAX_ARGS) return false;
    const counts = revArgs.filter((a) => typeof a === 'string' && COUNT_RE.test(a));
    const revs = revArgs.filter((a) => !counts.includes(a));
    if (counts.length > 1 || revs.length === 0 || !revs.every(isSafeRevision)) return false;
    const out = runGit(root, ['log', ...LOG_SAFETY_ARGS, '-z', FORMAT, ...counts, '--end-of-options', ...revs, '--']);
    return out !== null && out.split('\0').some(optsOut);
}
