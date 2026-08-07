import { execFileSync } from 'child_process';
import path from 'path';

/**
 * Resolving "what changed" for `awm sensors run --changed`.
 *
 * The sensors measure the whole repo on every run, so their cost scales with the
 * size of the repo rather than with the size of the change. A feature touching six
 * files pays for two thousand. Raising the timeout buys a quarter; scoping the work
 * to the diff is what actually changes the exponent.
 *
 * Scoping is NOT applied to every sensor — see `SensorConfig.changedCmd`. It is
 * sound only where a finding is a property of the file it lives in (eslint,
 * semgrep). A whole-program checker like `tsc` cannot be handed a subset without
 * changing what it means: types cross files, so a scoped `tsc` would report clean
 * while the change broke a caller it was never shown. That is a false green, which
 * is the exact failure this module must not manufacture.
 */

/** Union of committed diff vs `base`, staged, unstaged and untracked files. */
export type ChangedFiles = {
    files: string[];
    /** Set when the scope could not be resolved (not a repo, git absent, bad ref). */
    error?: string;
};

function git(args: string[], cwd: string): string {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

/**
 * The default comparison point. `merge-base HEAD <base>` — not `base` directly —
 * so a branch that is merely *behind* its base does not report every file the base
 * moved on as "changed" by this branch.
 */
function mergeBase(base: string, cwd: string): string {
    return git(['merge-base', 'HEAD', base], cwd).trim();
}

/**
 * Files this working tree changed relative to `base`.
 *
 * Deliberately a union of four sources: the committed diff since the merge base,
 * plus staged, unstaged and untracked files. A sensor gate runs mid-work, where the
 * interesting edits are usually not committed yet — a committed-only diff would scope
 * the run to a stale set and certify files nobody is editing.
 *
 * Untracked files are included but ignored files are not (`--exclude-standard`), so
 * `node_modules` and build output never enter the scope.
 *
 * Never throws: a failure to resolve the scope returns `error`, and the caller
 * degrades to the unscoped command rather than guessing at a narrower one.
 */
export function changedFiles(cwd: string, base = 'HEAD'): ChangedFiles {
    let out: string[] = [];
    try {
        // `HEAD` means "everything not yet committed" — no merge-base needed, and it
        // is the right default for a gate that runs before the work is committed.
        if (base !== 'HEAD') {
            const from = mergeBase(base, cwd);
            out = out.concat(git(['diff', '--name-only', '--diff-filter=d', from, 'HEAD'], cwd).split('\n'));
        }
        out = out.concat(git(['diff', '--name-only', '--diff-filter=d', 'HEAD'], cwd).split('\n'));
        out = out.concat(git(['diff', '--name-only', '--diff-filter=d', '--cached'], cwd).split('\n'));
        out = out.concat(git(['ls-files', '--others', '--exclude-standard'], cwd).split('\n'));
    } catch (e) {
        return { files: [], error: (e as Error).message.split('\n')[0] };
    }
    const files = Array.from(new Set(out.map(s => s.trim()).filter(Boolean))).sort();
    return { files };
}

/**
 * Quote a path for a shell command line. Sensor commands are strings run through a
 * shell, so a path with a space or a quote in it would otherwise split into two
 * arguments — or, worse, end the quoting and let the rest of the name be read as
 * shell syntax. Single quotes with the `'\''` escape are the only form POSIX shells
 * treat as fully literal.
 */
function shellQuote(file: string): string {
    return `'${file.replace(/'/g, `'\\''`)}'`;
}

/**
 * Substitute the file list into a `changedCmd` template.
 *
 * The template must contain `{files}`. A template without it would silently run over
 * the whole repo while the output claimed the run was scoped, so that case is
 * rejected by the caller rather than papered over here.
 */
export function applyChangedCmd(template: string, files: string[]): string {
    return template.replace('{files}', files.map(shellQuote).join(' '));
}

/**
 * Narrow the changed set to what a given sensor can be handed.
 *
 * The changed set is everything the tree touched — a README, a lockfile, a PNG. The
 * tools do not shrug those off: eslint given a `.md` fails rather than skipping it,
 * so an unfiltered scoped run would turn "you edited the docs" into a red gate.
 *
 * Case-insensitive because Windows and macOS checkouts routinely carry `.TS`/`.Ts`,
 * and a case-sensitive match would silently drop those files from the scope — the
 * quiet direction of wrong, where the sensor reports clean over files it never saw.
 */
export function filterByExtension(files: string[], extensions?: string[]): string[] {
    if (!extensions || extensions.length === 0) return files;
    const allowed = new Set(extensions.map(e => e.toLowerCase()));
    return files.filter(f => allowed.has(path.extname(f).toLowerCase()));
}
