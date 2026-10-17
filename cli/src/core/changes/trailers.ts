import { isSafeRevision, runGit } from './git';

export const OPT_OUT_TRAILER = 'Change-Record';

// NUL separates the values: a commit message cannot contain it, so a value cannot fake a boundary. A folded value
// ("Change-Record: x\n none") keeps its line break, so it is never equal to "none".
const FORMAT = `--format=%(trailers:key=${OPT_OUT_TRAILER},valueonly,separator=%x00)%x00`;
const COUNT_RE = /^-\d{1,4}$/;
const MAX_ARGS = 16;

/**
 * True when any commit selected by `revArgs` (e.g. ['a..b'] or ['-1', sha]) carries `Change-Record: none`.
 * Only a commit count (`-N`) and safe revisions are accepted; anything else, and any git failure, is `false`.
 */
export function hasOptOut(root: string, revArgs: string[]): boolean {
    if (!Array.isArray(revArgs) || revArgs.length === 0 || revArgs.length > MAX_ARGS) return false;
    const counts = revArgs.filter((a) => typeof a === 'string' && COUNT_RE.test(a));
    const revs = revArgs.filter((a) => !counts.includes(a));
    if (counts.length > 1 || revs.length === 0 || !revs.every(isSafeRevision)) return false;
    const out = runGit(root, ['log', FORMAT, ...counts, '--end-of-options', ...revs, '--']);
    return out !== null && out.split('\0').some((value) => value.trim().toLowerCase() === 'none');
}
