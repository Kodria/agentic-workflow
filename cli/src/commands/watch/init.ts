// Bootstrap unico writer (R4.1) + validacion MECANICA plan-vs-repo (R1.4b,
// bloqueador 5): la config real del repo determina los verificadores exigidos.
import fs from 'fs';
import path from 'path';
import { initJournal, readJournal, writeJournal } from '../../core/journal/store';
import type { VerificationKind } from '../../core/journal/types';

export function detectRequiredVerifiers(repoRoot: string): VerificationKind[] {
    const kinds: VerificationKind[] = [];
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
        if (typeof pkg === 'object' && pkg !== null && typeof pkg.scripts === 'object' && pkg.scripts !== null && typeof pkg.scripts.test === 'string') {
            kinds.push('test');
        }
    } catch { /* sin package.json legible: no se exige suite */ }
    if (fs.existsSync(path.join(repoRoot, '.awm', 'sensors.json'))) kinds.push('sensors');
    return kinds;
}

/** El journal es gitignoreado (R1.1): sus escrituras jamas alteran fingerprints. */
export function ensureJournalGitignored(repoRoot: string): void {
    const gi = path.join(repoRoot, '.gitignore');
    let current = '';
    try { current = fs.readFileSync(gi, 'utf8'); } catch { current = ''; }
    if (!current.split('\n').some((l) => l.trim() === '.awm/' || l.trim() === '.awm')) {
        fs.writeFileSync(gi, current.length > 0 && !current.endsWith('\n') ? `${current}\n.awm/\n` : `${current}.awm/\n`);
    }
}

export function initWatch(repoRoot: string, branch: string): { requiredVerifiers: VerificationKind[] } {
    ensureJournalGitignored(repoRoot);
    initJournal(repoRoot, branch);
    const required = detectRequiredVerifiers(repoRoot);
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto tras init: no se continua (R1.6)');
    const s = r.state;
    if (JSON.stringify(s.requiredVerifiers) !== JSON.stringify(required)) {
        s.requiredVerifiers = required;
        writeJournal(repoRoot, branch, s);
    }
    return { requiredVerifiers: required };
}
