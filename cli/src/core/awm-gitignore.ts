import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/** Marker lines for the managed `.gitignore` block (ASCII, exact). */
export const AWM_GITIGNORE_BEGIN = '# AWM:GITIGNORE:BEGIN';
export const AWM_GITIGNORE_END = '# AWM:GITIGNORE:END';

/** Project config under `.awm/` that must remain commit-able (D-024). */
export const AWM_VERSIONED_PATHS: readonly string[] = [
    '.awm/sensors.json',
    '.awm/sensors.baseline.json',
    '.awm/profile.json',
    '.awm/context-budget.json',
    '.awm/context/index.json',
];

/** Runtime / local state under `.awm/` that must not be tracked (D-024). */
export const AWM_LOCAL_PATHS: readonly string[] = [
    '.awm/journal',
    '.awm/ledger',
    '.awm/evidence',
    '.awm/track.json',
    '.awm/sensors/runs',
];

const MANAGED_LINES: readonly string[] = [
    '.awm/*',
    '!.awm/sensors.json',
    '!.awm/sensors.baseline.json',
    '!.awm/profile.json',
    '!.awm/context-budget.json',
    '!.awm/context/',
    '.awm/context/*',
    '!.awm/context/index.json',
];

/** Canonical managed block including begin/end markers and a trailing newline. */
export function renderManagedBlock(): string {
    return [AWM_GITIGNORE_BEGIN, ...MANAGED_LINES, AWM_GITIGNORE_END, ''].join('\n');
}

function isBlanketAwmIgnore(line: string): boolean {
    const t = line.trim();
    return t === '.awm' || t === '.awm/';
}

/**
 * Upsert the managed AWM `.gitignore` block at the repository root.
 * Idempotent when the block already matches. Migrates bare `.awm` / `.awm/`
 * lines outside the block. Refuses a symlink `.gitignore`.
 */
export function upsertAwmGitignore(repoRoot: string): void {
    if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
        throw new Error('upsertAwmGitignore requires a non-empty repository root');
    }
    const gi = path.join(repoRoot, '.gitignore');
    let current = '';
    try {
        if (fs.lstatSync(gi).isSymbolicLink()) {
            throw new Error('.gitignore must not be a symlink');
        }
        current = fs.readFileSync(gi, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const normalized = current.replace(/\r\n/g, '\n');
    const block = renderManagedBlock();
    const begin = normalized.indexOf(AWM_GITIGNORE_BEGIN);
    const end = normalized.indexOf(AWM_GITIGNORE_END);

    let withoutManaged: string;
    if (begin !== -1 && end !== -1 && end > begin) {
        const afterEnd = end + AWM_GITIGNORE_END.length;
        const skipNewline = normalized[afterEnd] === '\n' ? afterEnd + 1 : afterEnd;
        withoutManaged = normalized.slice(0, begin) + normalized.slice(skipNewline);
    } else if (begin !== -1 || end !== -1) {
        // Malformed markers: strip both marker lines and rebuild cleanly.
        withoutManaged = normalized
            .split('\n')
            .filter((line) => line !== AWM_GITIGNORE_BEGIN && line !== AWM_GITIGNORE_END)
            .join('\n');
    } else {
        withoutManaged = normalized;
    }

    const preserved = withoutManaged
        .split('\n')
        .filter((line) => !isBlanketAwmIgnore(line))
        .join('\n')
        .replace(/\n+$/g, '');

    const next = preserved.length > 0 ? `${preserved}\n${block}` : block;
    if (next === normalized || next === current.replace(/\r\n/g, '\n')) {
        // Already equivalent after normalize — avoid touching mtime when identical.
        if (fs.existsSync(gi) && fs.readFileSync(gi, 'utf8').replace(/\r\n/g, '\n') === next) return;
    }
    fs.writeFileSync(gi, next);
}

export type AwmGitignorePolicyResult =
    | { ok: true; skipped?: boolean; detail: string }
    | { ok: false; detail: string; remedy: string };

function gitOk(repoRoot: string, args: string[]): { ok: true; stdout: string } | { ok: false; code: number; stdout: string } {
    try {
        const stdout = execFileSync('git', args, {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            env: process.env,
        });
        return { ok: true, stdout };
    } catch (error) {
        const err = error as { status?: number; stdout?: string };
        return { ok: false, code: typeof err.status === 'number' ? err.status : 1, stdout: typeof err.stdout === 'string' ? err.stdout : '' };
    }
}

function isGitRepo(repoRoot: string): boolean {
    const result = gitOk(repoRoot, ['rev-parse', '--is-inside-work-tree']);
    return result.ok && result.stdout.trim() === 'true';
}

function managedBlockPresent(repoRoot: string): boolean {
    const gi = path.join(repoRoot, '.gitignore');
    try {
        const text = fs.readFileSync(gi, 'utf8');
        return text.includes(AWM_GITIGNORE_BEGIN) && text.includes(AWM_GITIGNORE_END);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

function pathExistsUnderRoot(repoRoot: string, rel: string): boolean {
    try {
        fs.lstatSync(path.join(repoRoot, rel));
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

function awmTreePresent(repoRoot: string): boolean {
    return pathExistsUnderRoot(repoRoot, '.awm') || AWM_VERSIONED_PATHS.some((p) => pathExistsUnderRoot(repoRoot, p));
}

/**
 * Blocking policy check for doctor/preflight (GI-6..GI-8).
 * Skips cleanly when not inside a git work tree.
 */
export function evaluateAwmGitignorePolicy(repoRoot: string): AwmGitignorePolicyResult {
    if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
        throw new Error('evaluateAwmGitignorePolicy requires a non-empty repository root');
    }
    if (!isGitRepo(repoRoot)) {
        return { ok: true, skipped: true, detail: 'skipped (not a git repository)' };
    }

    const trackedLocal: string[] = [];
    for (const local of AWM_LOCAL_PATHS) {
        const listed = gitOk(repoRoot, ['ls-files', '-z', '--', local]);
        if (!listed.ok) continue;
        const paths = listed.stdout.split('\0').filter(Boolean);
        trackedLocal.push(...paths);
    }

    const ignoredVersioned: string[] = [];
    for (const versioned of AWM_VERSIONED_PATHS) {
        if (!pathExistsUnderRoot(repoRoot, versioned)) continue;
        const ignore = gitOk(repoRoot, ['check-ignore', '-q', '--', versioned]);
        // exit 0 → ignored; exit 1 → not ignored; other → treat as not ignored (fail-open on check only)
        if (ignore.ok || ignore.code === 0) ignoredVersioned.push(versioned);
    }

    const needsBlock = awmTreePresent(repoRoot) || trackedLocal.length > 0;
    const missingBlock = needsBlock && !managedBlockPresent(repoRoot);

    if (trackedLocal.length === 0 && ignoredVersioned.length === 0 && !missingBlock) {
        return { ok: true, detail: needsBlock ? 'managed .awm gitignore policy satisfied' : 'no .awm project state' };
    }

    const parts: string[] = [];
    if (trackedLocal.length > 0) {
        parts.push(`tracked local runtime: ${trackedLocal.slice(0, 8).join(', ')}${trackedLocal.length > 8 ? '…' : ''}`);
    }
    if (ignoredVersioned.length > 0) {
        parts.push(`versioned config ignored: ${ignoredVersioned.join(', ')}`);
    }
    if (missingBlock) {
        parts.push('managed # AWM:GITIGNORE block missing or incomplete');
    }

    const remedyParts: string[] = [
        'run `awm sensors init` or `awm watch init` to upsert the managed .gitignore block',
    ];
    if (trackedLocal.length > 0) {
        const shown = trackedLocal.slice(0, 16).join(' ');
        remedyParts.push(`then \`git rm --cached -- ${shown}${trackedLocal.length > 16 ? ' …' : ''}\``);
    }

    return { ok: false, detail: parts.join('; '), remedy: remedyParts.join('; ') };
}
