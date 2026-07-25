// tests/core/install-transaction.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    applyInstallPlan,
    defaultTransactionDeps,
    beginBackupSession,
    restoreBackup,
} from '../../src/core/install-transaction';
import { InstallPlan, PlannedOperation } from '../../src/core/install-planner';

// Per CLAUDE.md: no test may touch the real ~/.awm. Every test here backs up
// or transacts through awmHome(), so HOME/AWM_HOME must point at an isolated
// tmpdir (pattern from tests/commands/hooks/install.test.ts).
let tmpHome: string;
let tmpWork: string;
let originalHome: string | undefined;
let originalAwmHome: string | undefined;

beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-txn-home-'));
    tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-txn-work-'));
    originalHome = process.env.HOME;
    originalAwmHome = process.env.AWM_HOME;
    process.env.HOME = tmpHome;
    process.env.AWM_HOME = path.join(tmpHome, '.awm');
});

afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpWork, { recursive: true, force: true });
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalAwmHome === undefined) delete process.env.AWM_HOME;
    else process.env.AWM_HOME = originalAwmHome;
});

function makeOp(name: string, overrides: Partial<PlannedOperation> = {}): PlannedOperation {
    return {
        name,
        type: 'skill',
        scope: 'local',
        targetPath: path.join(tmpWork, name),
        sourcePath: path.join(tmpWork, `${name}-source`),
        renderer: 'link',
        owners: ['claude-code'],
        method: 'copy',
        output: 'link',
        ...overrides,
    };
}

function planWithTwoTargets(): InstallPlan {
    const a = makeOp('a');
    const b = makeOp('b');
    return { operations: [a, b], records: [], reports: [] };
}

function planWithThreeTargets(): InstallPlan {
    const a = makeOp('a');
    const b = makeOp('b');
    const c = makeOp('c');
    return { operations: [a, b, c], records: [], reports: [] };
}

/**
 * Builds a plan whose second operation ("b") is guaranteed to be replaced
 * (real filesystem write) before verification runs, letting the test force a
 * verification failure via a `verify` override while still exercising the
 * REAL default backup/stage/replace/rollback pipeline underneath.
 */
function planThatFailsSecondVerification(original: string): InstallPlan {
    const sourceA = path.join(tmpWork, 'source-a');
    fs.mkdirSync(sourceA, { recursive: true });
    fs.writeFileSync(path.join(sourceA, 'file.txt'), 'new-a');

    const sourceB = path.join(tmpWork, 'source-b');
    fs.mkdirSync(sourceB, { recursive: true });
    fs.writeFileSync(path.join(sourceB, 'file.txt'), 'new-b');

    const opA = makeOp('a', { targetPath: original, sourcePath: sourceA });
    const opB = makeOp('b', { targetPath: path.join(tmpWork, 'target-b'), sourcePath: sourceB });
    return { operations: [opA, opB], records: [], reports: [] };
}

describe('applyInstallPlan', () => {
    it('validates and backs up every target before the first replacement', () => {
        const calls: string[] = [];
        applyInstallPlan(planWithTwoTargets(), {
            validate: (op) => calls.push(`validate:${op.name}`),
            backup: (op) => { calls.push(`backup:${op.name}`); return null; },
            stage: (op) => { calls.push(`stage:${op.name}`); return `/staged/${op.name}`; },
            replace: (op) => calls.push(`replace:${op.name}`),
            verify: (op) => calls.push(`verify:${op.name}`),
            rollback: (op) => calls.push(`rollback:${op.name}`),
        });
        expect(calls.indexOf('validate:a')).toBeLessThan(calls.indexOf('backup:a'));
        expect(calls.indexOf('backup:b')).toBeLessThan(calls.indexOf('replace:a')); // verifies R24.1
    });

    it('restores already replaced targets when verification fails', () => {
        const original = path.join(tmpWork, 'target-a');
        fs.mkdirSync(original, { recursive: true });
        fs.writeFileSync(path.join(original, 'sentinel'), 'before');
        const plan = planThatFailsSecondVerification(original);

        const deps = {
            ...defaultTransactionDeps(),
            verify: (op: PlannedOperation) => {
                if (op.name === 'b') throw new Error('verification failed: forced for test');
            },
        };

        expect(() => applyInstallPlan(plan, deps)).toThrow('verification failed');
        expect(fs.readFileSync(path.join(original, 'sentinel'), 'utf8')).toBe('before'); // verifies R25
    });

    it('returns a transactionId and the list of modified files on success', () => {
        const sourceA = path.join(tmpWork, 'source-a');
        fs.mkdirSync(sourceA, { recursive: true });
        fs.writeFileSync(path.join(sourceA, 'file.txt'), 'content-a');
        const targetA = path.join(tmpWork, 'target-a');
        const plan: InstallPlan = {
            operations: [makeOp('a', { targetPath: targetA, sourcePath: sourceA })],
            records: [],
            reports: [{ owner: 'claude-code', targetPath: targetA, action: 'install' }],
        };

        const summary = applyInstallPlan(plan);
        expect(summary.transactionId).toBeTruthy();
        expect(summary.modifiedFiles).toEqual([targetA]);
        expect(fs.existsSync(path.join(targetA, 'file.txt'))).toBe(true);

        const backupDir = path.join(process.env.AWM_HOME!, 'backups', summary.transactionId);
        expect(fs.existsSync(path.join(backupDir, 'manifest.json'))).toBe(true);
    });

    it('is a safe no-op for an empty plan', () => {
        const summary = applyInstallPlan({ operations: [], records: [], reports: [] });
        expect(summary.installed).toEqual([]);
        expect(summary.modifiedFiles).toEqual([]);
        expect(summary.transactionId).toBeTruthy();
    });

    it('keeps rolling back remaining targets, and still surfaces the original error, when a MIDDLE rollback fails', () => {
        // 3 ops (a, b, c) all replaced; verification fails on 'c', so rollback
        // runs in reverse order: c, b, a. Making 'b' — the middle op in that
        // reversed order, with an op both before and after it in the loop —
        // the one that throws is what actually proves the per-op try/catch
        // isolates failures: 'a' still runs AFTER 'b' throws, not just
        // trivially "nothing left to run" as a last-in-order failure would.
        const calls: string[] = [];
        const plan = planWithThreeTargets();

        expect(() => applyInstallPlan(plan, {
            validate: () => {},
            backup: () => null,
            stage: (op) => `/staged/${op.name}`,
            replace: (op) => calls.push(`replace:${op.name}`),
            verify: (op) => { if (op.name === 'c') throw new Error('verification failed: forced'); },
            rollback: (op) => {
                calls.push(`rollback:${op.name}`);
                if (op.name === 'b') throw new Error('rollback failed for b (simulated)');
            },
        })).toThrow('verification failed: forced');

        // All three replaced ops got a rollback attempt, in reverse order —
        // including 'a', which runs strictly after 'b' throws, proving the
        // loop doesn't stop or skip ahead when a non-terminal rollback fails.
        expect(calls).toEqual(['replace:a', 'replace:b', 'replace:c', 'rollback:c', 'rollback:b', 'rollback:a']);
    });
});

describe('beginBackupSession / restoreBackup', () => {
    it('backs up existing targets before mutation and restores them on rollback', () => {
        const fileA = path.join(tmpWork, 'a.json');
        const fileB = path.join(tmpWork, 'b.json');
        fs.writeFileSync(fileA, 'A-before');
        fs.writeFileSync(fileB, 'B-before');

        const session = beginBackupSession([fileA, fileB]);
        fs.writeFileSync(fileA, 'A-after');
        fs.writeFileSync(fileB, 'B-after');

        session.rollback();

        expect(fs.readFileSync(fileA, 'utf8')).toBe('A-before');
        expect(fs.readFileSync(fileB, 'utf8')).toBe('B-before');
    });

    it('removes a target that did not exist before the session, on rollback', () => {
        const newFile = path.join(tmpWork, 'created.json');
        const session = beginBackupSession([newFile]);
        fs.writeFileSync(newFile, 'created content');

        session.rollback();

        expect(fs.existsSync(newFile)).toBe(false);
    });

    it('commit marks the manifest committed without restoring anything', () => {
        const fileA = path.join(tmpWork, 'c.json');
        fs.writeFileSync(fileA, 'C-before');
        const session = beginBackupSession([fileA]);
        fs.writeFileSync(fileA, 'C-after');

        session.commit();

        expect(fs.readFileSync(fileA, 'utf8')).toBe('C-after');
        const manifestPath = path.join(process.env.AWM_HOME!, 'backups', session.transactionId, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        expect(manifest.committed).toBe(true);
    });

    it('refuses to back up a filesystem root', () => {
        expect(() => beginBackupSession(['/'])).toThrow('refusing to back up a filesystem root');
    });

    it('creates the backup directory and manifest with restrictive permissions, no content leaked', () => {
        const fileA = path.join(tmpWork, 'perm.json');
        fs.writeFileSync(fileA, 'secret-content');
        const session = beginBackupSession([fileA]);

        const backupDir = path.join(process.env.AWM_HOME!, 'backups', session.transactionId);
        const dirMode = fs.statSync(backupDir).mode & 0o777;
        const manifestPath = path.join(backupDir, 'manifest.json');
        const manifestMode = fs.statSync(manifestPath).mode & 0o777;
        expect(dirMode).toBe(0o700);
        expect(manifestMode).toBe(0o600);

        const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
        expect(manifestRaw).not.toContain('secret-content');
    });

    it('restoreBackup restores exactly the manifest targets', () => {
        const fileA = path.join(tmpWork, 'd.json');
        fs.writeFileSync(fileA, 'D-before');
        const session = beginBackupSession([fileA]);
        fs.writeFileSync(fileA, 'D-after');

        const result = restoreBackup(session.transactionId);

        expect(result.restored).toEqual([fileA]);
        expect(fs.readFileSync(fileA, 'utf8')).toBe('D-before');
    });
});
