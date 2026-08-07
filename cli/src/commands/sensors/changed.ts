import { execFileSync } from 'child_process';
import path from 'path';
import { isWindowsNative } from '../../core/paths';

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
 * cmd.exe metacharacters that quoting does NOT reliably neutralize.
 *
 * Per the BatBadBut / CVE-2024-27980 research (flatt.tech/research/posts/batbadbut-
 * you-cant-securely-execute-commands-on-windows/ — the paper Node's own CVE fix was
 * based on), `%` still triggers environment-variable expansion *inside* a
 * double-quoted string, and `&` can break a command out of quoting under certain
 * conditions. cmd.exe parses these BEFORE the target program ever sees argv, so no
 * amount of `"..."`/`\"` escaping at the argv layer (which is all `shellQuote` can
 * touch) is a complete guarantee against them. Newline/CR are included because the
 * same research flags them, and they are nonsensical in a real path regardless.
 *
 * This is a denylist, not an escaping table, on purpose: the responsible fix for
 * this vulnerability class is to REFUSE (fall back to the full, unscoped command —
 * see `run.ts`), not to hand-roll a smarter cmd.exe escaper. Node's own security
 * team reached the same conclusion for the identical problem.
 */
const WIN32_UNSAFE_CHARS = /[&|<>^%\r\n]/;

/** True when `file` contains a character cmd.exe would parse as its own syntax. */
export function hasUnsafeWin32Chars(file: string): boolean {
    return WIN32_UNSAFE_CHARS.test(file);
}

/**
 * CommandLineToArgvW-safe quoting (the algorithm behind Python's
 * `subprocess.list2cmdline`, Rust's `std::process::Command` on Windows, and .NET's
 * argument escaper). Per the documented rule
 * (learn.microsoft.com/en-us/cpp/c-language/parsing-c-command-line-arguments):
 * an EVEN run of backslashes before a `"` collapses to half as many literal
 * backslashes and the `"` is a real delimiter; an ODD run collapses the same way
 * but the leftover backslash escapes the `"` into a literal character instead of a
 * delimiter. Backslashes not followed by a `"` are always literal and untouched.
 *
 * This alone does not make interpolation safe on win32 — see `hasUnsafeWin32Chars`
 * and its callers in `run.ts` for the metacharacter layer this cannot address.
 */
function win32ArgvQuote(arg: string): string {
    let result = '"';
    let backslashes = 0;
    for (const ch of arg) {
        if (ch === '\\') {
            backslashes++;
        } else if (ch === '"') {
            result += '\\'.repeat(backslashes * 2 + 1) + '"';
            backslashes = 0;
        } else {
            result += '\\'.repeat(backslashes) + ch;
            backslashes = 0;
        }
    }
    result += '\\'.repeat(backslashes * 2); // double any trailing run before the closing quote
    result += '"';
    return result;
}

/**
 * Quote a path for a shell command line. Sensor commands are strings run through a
 * shell, so a path with a space or a quote in it would otherwise split into two
 * arguments — or, worse, end the quoting and let the rest of the name be read as
 * shell syntax.
 *
 * `runCommand` (see `exec.ts`) spawns this string with `shell: true`, which on
 * win32 is `cmd.exe`, not a POSIX shell. Single quotes are not quoting syntax to
 * cmd.exe — it just splits on the space inside them — so a POSIX-only quote here
 * would silently hand eslint/semgrep two garbage arguments instead of one real
 * path. `'\''` (single quotes with the escape) is what POSIX shells treat as fully
 * literal — no exceptions, per POSIX shell grammar, so no metacharacter denylist is
 * needed on that branch. On win32, `win32ArgvQuote` is the argv-layer half of
 * safety; the metacharacter denylist above (enforced by the caller in `run.ts`,
 * before this function is ever reached) is the other half this function cannot
 * provide on its own.
 */
function shellQuote(file: string): string {
    if (isWindowsNative()) {
        return win32ArgvQuote(file);
    }
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
