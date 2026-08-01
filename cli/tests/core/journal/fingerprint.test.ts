import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { computeFingerprint } from '../../../src/core/journal/fingerprint';

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd });
}

describe('computeFingerprint', () => {
    let repo: string;
    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-fp-'));
        git(repo, 'init', '-q');
        fs.writeFileSync(path.join(repo, 'a.txt'), 'uno');
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c1');
    });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('mismo comando + mismo arbol + mismo cwd => mismo fingerprint (R3.4)', () => {   // verifies R3.4
        const a = computeFingerprint(repo, ['npm', 'test'], [], '.');
        const b = computeFingerprint(repo, ['npm', 'test'], [], '.');
        expect(a.fingerprint).toBe(b.fingerprint);
        expect(a.commandDigest).toBe(b.commandDigest);
    });

    test('cambio en tracked, untracked o argv cambia el fingerprint (R3.4)', () => {  // verifies R3.4
        const base = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        fs.writeFileSync(path.join(repo, 'a.txt'), 'dos');
        const mod = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        expect(mod).not.toBe(base);
        git(repo, 'checkout', '-q', '--', '.');
        fs.writeFileSync(path.join(repo, 'nuevo.txt'), 'x');
        const untracked = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        expect(untracked).not.toBe(base);
        fs.rmSync(path.join(repo, 'nuevo.txt'));
        const otherCmd = computeFingerprint(repo, ['npm', 'run', 'lint'], [], '.').fingerprint;
        expect(otherCmd).not.toBe(base);
    });

    test('cambio staged-only altera el fingerprint — indice real hasheado (R3.4)', () => {  // verifies R3.4
        const base = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        fs.writeFileSync(path.join(repo, 'a.txt'), 'dos');
        git(repo, 'add', 'a.txt');
        fs.writeFileSync(path.join(repo, 'a.txt'), 'uno');   // worktree identico al base; SOLO el indice cambio
        const stagedOnly = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        expect(stagedOnly).not.toBe(base);
    });

    test('cwd distinto altera el fingerprint; cwd fuera del repo se rechaza (R3.4)', () => {  // verifies R3.4
        fs.mkdirSync(path.join(repo, 'sub'));
        const root = computeFingerprint(repo, ['npm', 'test'], [], '.').fingerprint;
        const sub = computeFingerprint(repo, ['npm', 'test'], [], 'sub').fingerprint;
        expect(sub).not.toBe(root);
        expect(() => computeFingerprint(repo, ['npm', 'test'], [], '../fuera')).toThrow(/cwd/);
        expect(() => computeFingerprint(repo, ['npm', 'test'], [], '/abs')).toThrow(/cwd/);
    });

    test('la expansion de paths queda persistida y excluye .awm (R3.4)', () => {          // verifies R3.4
        fs.mkdirSync(path.join(repo, '.awm', 'journal'), { recursive: true });
        fs.writeFileSync(path.join(repo, '.awm', 'journal', 'state.json'), '{}');
        const r = computeFingerprint(repo, ['npm', 'test'], ['a.txt'], '.');
        expect(r.expandedPaths).toEqual(['a.txt']);
        const all = computeFingerprint(repo, ['npm', 'test'], [], '.');
        expect(all.expandedPaths.some((p) => p.startsWith('.awm/'))).toBe(false);
    });
});
