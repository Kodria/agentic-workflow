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
