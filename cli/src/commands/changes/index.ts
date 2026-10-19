import path from 'path';
import { Command } from 'commander';
import type { CommandResult } from '../../core/command-result';
import { fail, failed, inCwd } from '../../core/changes/command';
import { repoRoot } from '../../core/changes/git';
import { listChanges } from '../../core/changes/list';
import { parseSince } from '../../core/changes/list-parse';
import { BASE_OPTION_HELP } from '../../core/changes/range';
import { renderJson, renderText, renderVoice } from '../../core/changes/render-list';
import { esc, isObj } from '../../core/changes/text-safety';

export interface ChangesDeps { now?: () => Date; limit?: number }
export interface ListOpts { since?: string; base?: string; format?: string }

const FORMATS: readonly string[] = ['text', 'json', 'voice'];
const DEFAULT_SINCE = '24h';

/** A static description of the first flag of the wrong type, or null. */
function flagProblem(opts: Record<string, unknown>): string | null {
    for (const key of ['since', 'base', 'format'] as const) if (opts[key] !== undefined && typeof opts[key] !== 'string') return `--${key} must be a string`;
    return null;
}

/** The clock's instant, or null when the clock throws or does not yield a valid date. */
function clock(deps: ChangesDeps): Date | null {
    try {
        const moment = (deps.now ?? (() => new Date()))();
        return moment instanceof Date && !Number.isNaN(moment.getTime()) ? moment : null;
    } catch {
        return null;
    }
}

function changesList(cwd: unknown, rawOpts: unknown, rawDeps: unknown): CommandResult {
    if (typeof cwd !== 'string' || cwd.length === 0) return fail('invalid-input', 'the working directory must be a non-empty string');
    if (rawOpts !== undefined && !isObj(rawOpts)) return fail('flag-invalid', 'options must be an object');
    if (rawDeps !== undefined && !isObj(rawDeps)) return fail('invalid-input', 'dependencies must be an object');
    const opts = (rawOpts ?? {}) as ListOpts;
    const deps = (rawDeps ?? {}) as ChangesDeps;
    const flag = flagProblem(opts as Record<string, unknown>);
    if (flag) return fail('flag-invalid', flag);

    const format = opts.format ?? 'text';
    if (!FORMATS.includes(format)) return fail('format-invalid', `--format "${esc(format)}" must be text, json or voice`);
    const moment = clock(deps);
    if (moment === null) return fail('invalid-input', 'the clock did not yield a valid date');
    const window = opts.since ?? DEFAULT_SINCE;
    const since = parseSince(window, moment);
    if (since === null) return fail('since-invalid', `--since "${esc(window)}" must be <n>h, <n>d or YYYY-MM-DD`);

    const root = repoRoot(cwd);
    if (root === null) return fail('not-a-git-repo', 'awm changes must run inside a git repository');
    const outcome = listChanges(root, { base: opts.base, since, limit: deps.limit });
    if (!outcome.ok) return failed(outcome.failure);

    const fallback = path.basename(root);
    const stdout = format === 'json' ? renderJson(outcome.result) : format === 'voice' ? renderVoice(outcome.result, fallback) : renderText(outcome.result, fallback);
    return { code: 0, stdout, stderr: '' };
}

/** `awm changes list`: read-only; never throws (any unexpected failure becomes an `internal-error` on stderr). */
export function runChangesList(cwd: string, opts: ListOpts, deps: ChangesDeps = {}): CommandResult {
    try {
        return changesList(cwd, opts, deps);
    } catch (error) {
        return fail('internal-error', `unexpected failure (${esc(error instanceof Error ? error.name : 'unknown')})`);
    }
}

export function registerChangesCommand(program: Command, deps: ChangesDeps = {}): void {
    const changes = program.command('changes').description('query the Change Records merged into the base branch');
    changes
        .command('list')
        .description('list the changes of the base branch with their Change Record and derived merge/release state')
        .option('--since <window>', '<n>h, <n>d or YYYY-MM-DD (default 24h)')
        .option('--base <ref>', BASE_OPTION_HELP)
        .option('--format <format>', 'text | json | voice (default text)')
        .action((opts: ListOpts) => inCwd((cwd) => runChangesList(cwd, opts, deps), () => fail('not-a-git-repo', 'the working directory is not accessible')));
}
