import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { acquireLock, releaseLock, verifyBranchInvariant, LockBlockedError } from '../../../src/commands/watch/lock';
import { supervisorLockPath } from '../../../src/core/journal/paths';

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd });
}

describe('supervisor lock + branch invariant', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-lock-')); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('adquisicion exclusiva: la segunda falla con supervisor vivo (R4.1)', () => {  // verifies R4.1
        const l1 = acquireLock(repo);
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(true);
        expect(() => acquireLock(repo)).toThrow(/supervisor activo/);
        releaseLock(repo, l1);
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(false);
    });

    test('lock con identidad muerta PROBADA se reclama con reintento unico (R4.1)', () => {  // verifies R4.1
        fs.mkdirSync(path.dirname(supervisorLockPath(repo)), { recursive: true });
        fs.writeFileSync(supervisorLockPath(repo), JSON.stringify({
            pid: 999999, startTime: 'gone', spawnNonce: 'x', argvDigest: 'y', processGroup: 999999, psArgsDigest: 'z',
        }));
        const l = acquireLock(repo);
        expect(l.ref.pid).toBe(process.pid);
        releaseLock(repo, l);
    });

    test('lock ilegible o con shape invalido => LockBlockedError, JAMAS se reclama (R4.1)', () => {  // verifies R4.1
        fs.mkdirSync(path.dirname(supervisorLockPath(repo)), { recursive: true });
        fs.writeFileSync(supervisorLockPath(repo), '{json roto');
        expect(() => acquireLock(repo)).toThrow(LockBlockedError);
        fs.writeFileSync(supervisorLockPath(repo), JSON.stringify({ pid: 1 }));   // shape parcial
        expect(() => acquireLock(repo)).toThrow(LockBlockedError);
        expect(fs.existsSync(supervisorLockPath(repo))).toBe(true);   // sigue ahi: nadie lo piso
    });

    test('branch invariant: discrepancia rama-journal => BLOCKED (R1.1)', () => {  // verifies R1.1
        git(repo, 'init', '-q', '-b', 'main');
        fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c');
        expect(() => verifyBranchInvariant(repo, 'main')).not.toThrow();
        git(repo, 'checkout', '-qb', 'otra');
        expect(() => verifyBranchInvariant(repo, 'main')).toThrow(/BLOCKED/);
    });

    test('branch invariant: HEAD detached => BLOCKED, jamas matchea (R1.1)', () => {  // verifies R1.1
        git(repo, 'init', '-q', '-b', 'main');
        fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
        git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'c');
        git(repo, 'checkout', '-q', '--detach', 'HEAD');
        expect(() => verifyBranchInvariant(repo, 'main')).toThrow(/BLOCKED/);
    });
});
