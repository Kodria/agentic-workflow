import fs from 'fs';
import path from 'path';
import os from 'os';
import { branchSlug, journalDir, supervisorLockPath } from '../../../src/core/journal/paths';

describe('journal paths', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-jpaths-')); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('branchSlug sanea separadores', () => {                          // verifies R1.1
        expect(branchSlug('claude/mi-rama')).toBe('claude_2Fmi-rama');
    });

    test('branchSlug es biyectivo: ramas distintas no colisionan (R1.1)', () => {  // verifies R1.1
        expect(branchSlug('a/b')).not.toBe(branchSlug('a_b'));
        expect(branchSlug('a/b')).not.toBe(branchSlug('a__b'));
    });

    test('journalDir es por-rama; el lock vive FUERA del dir de rama (R1.1)', () => {  // verifies R1.1
        const jd = journalDir(repo, 'a/b');
        const lock = supervisorLockPath(repo);
        expect(jd).toBe(path.join(repo, '.awm', 'journal', 'a_2Fb'));
        expect(lock).toBe(path.join(fs.realpathSync(repo), '.awm', 'journal', 'supervisor.lock'));
        expect(path.dirname(lock)).not.toBe(jd);
    });

    test('supervisorLockPath resuelve symlinks del worktree (R1.1)', () => {  // verifies R1.1
        const real = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-real-'));
        const link = path.join(repo, 'link');
        fs.symlinkSync(real, link);
        expect(supervisorLockPath(link)).toBe(path.join(fs.realpathSync(real), '.awm', 'journal', 'supervisor.lock'));
        fs.rmSync(real, { recursive: true, force: true });
    });
});
