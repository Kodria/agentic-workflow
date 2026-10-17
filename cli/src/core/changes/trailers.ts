import { LOG_SAFETY_ARGS, isSafeRevision, runGit } from './git';

export const OPT_OUT_TRAILER = 'Change-Record';

// Raw messages (%B), NUL-terminated by -z: a message cannot contain NUL, so one commit is exactly one record. Git's own
// %(trailers) is not used: it honours trailer.separators and trailer.<token>.key from the user's config, so what counts as
// an opt-out would differ per machine.
const FORMAT = '--format=%B';
const OPT_OUT_LINE = new RegExp(`^${OPT_OUT_TRAILER}:[ \\t]*none[ \\t]*$`, 'i');
const BLANK_LINE = /\r?\n[ \t]*\r?\n/;
const COUNT_RE = /^-\d{1,4}$/;
const MAX_ARGS = 16;

/** DD-6: a line of the final paragraph (never the subject's) that is exactly `Change-Record: none`. No folding, no other separator. */
function optsOut(message: string): boolean {
    const paragraphs = message.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '').split(BLANK_LINE);
    if (paragraphs.length < 2) return false;
    return paragraphs[paragraphs.length - 1].split(/\r?\n/).some((line) => OPT_OUT_LINE.test(line));
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
