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
import { readArtifactState } from '../../src/core/artifact-state';

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

    describe('artifact-state persistence across multiple calls (BLOCKER regression)', () => {
        // A real `awm init` run makes several separate applyInstallPlan calls
        // in sequence — one per bundle (dev-core, each ambient bundle, each
        // synced project extension). Each call's plan.records only covers the
        // artifacts THAT call touched. Persisting must be additive: an
        // earlier call's ownership records must survive a later call, not be
        // silently discarded by a wholesale overwrite of state/artifacts.json.
        function sourceFor(name: string): string {
            const src = path.join(tmpWork, `${name}-source`);
            fs.mkdirSync(src, { recursive: true });
            fs.writeFileSync(path.join(src, 'file.txt'), name);
            return src;
        }

        function planFor(name: string, targetPath: string): InstallPlan {
            const op = makeOp(name, { targetPath, sourcePath: sourceFor(name) });
            return { operations: [op], records: [op], reports: [{ owner: 'claude-code', targetPath, action: 'install' }] };
        }

        it('preserves an earlier applyInstallPlan call’s records after a later call for a DIFFERENT target', () => {
            const targetA = path.join(tmpWork, 'target-a');
            const targetB = path.join(tmpWork, 'target-b');

            applyInstallPlan(planFor('a', targetA));
            applyInstallPlan(planFor('b', targetB));

            const state = readArtifactState();
            expect(state.map((r) => r.targetPath).sort()).toEqual([targetA, targetB].sort());
        });

        it('replaces (does not duplicate) the record for a targetPath touched by two separate applyInstallPlan calls', () => {
            const targetA = path.join(tmpWork, 'target-a');

            applyInstallPlan(planFor('a', targetA));
            const secondOp = makeOp('a', { targetPath: targetA, sourcePath: sourceFor('a2'), owners: ['claude-code', 'codex'] });
            applyInstallPlan({
                operations: [secondOp],
                records: [secondOp],
                reports: [{ owner: 'codex', targetPath: targetA, action: 'retain' }],
            });

            const state = readArtifactState();
            expect(state).toHaveLength(1);
            expect(state[0].targetPath).toBe(targetA);
            expect(state[0].owners).toEqual(['claude-code', 'codex']);
        });
    });
});

describe('defaultTransactionDeps — cursor-mdc / copilot-instructions renderers (Task 4.3)', () => {
    // Both renderers are always 'skill'-type: sourcePath is the skill's
    // DIRECTORY (install-transaction.ts's readSkillMdSource), matching how
    // discovery.ts/bundle-install.ts set ArtifactIntent.sourcePath for
    // skills — mirrors the shape makeOp() already assumes for 'link' skills.
    function makeSkillSource(description: string, body: string): string {
        const dir = fs.mkdtempSync(path.join(tmpWork, 'skill-source-'));
        fs.writeFileSync(
            path.join(dir, 'SKILL.md'),
            `---\nname: sample-skill\ndescription: ${description}\n---\n\n${body}\n`,
        );
        return dir;
    }

    it('renders a real Cursor .mdc file through the full validate/stage/replace/verify pipeline', () => {
        const sourceDir = makeSkillSource('A sample skill', 'Body content for the skill.');
        const targetPath = path.join(tmpWork, 'sample-skill.mdc');
        const plan: InstallPlan = {
            operations: [makeOp('sample-skill', {
                type: 'skill', renderer: 'cursor-mdc', output: 'cursor-mdc',
                sourcePath: sourceDir, targetPath,
            })],
            records: [],
            reports: [{ owner: 'cursor', targetPath, action: 'install' }],
        };

        const summary = applyInstallPlan(plan);

        expect(summary.modifiedFiles).toEqual([targetPath]);
        const content = fs.readFileSync(targetPath, 'utf8');
        expect(content).toContain('description: A sample skill');
        expect(content).toContain('alwaysApply: false');
        expect(content).toContain('Body content for the skill.');
    });

    it('renders a real Copilot .instructions.md file through the full validate/stage/replace/verify pipeline', () => {
        const sourceDir = makeSkillSource('A sample skill', 'Body content for the skill.');
        const targetPath = path.join(tmpWork, 'sample-skill.instructions.md');
        const plan: InstallPlan = {
            operations: [makeOp('sample-skill', {
                type: 'skill', renderer: 'copilot-instructions', output: 'copilot-instructions',
                sourcePath: sourceDir, targetPath,
            })],
            records: [],
            reports: [{ owner: 'copilot', targetPath, action: 'install' }],
        };

        const summary = applyInstallPlan(plan);

        expect(summary.modifiedFiles).toEqual([targetPath]);
        const content = fs.readFileSync(targetPath, 'utf8');
        expect(content).toContain('applyTo: "**"');
        expect(content).toContain('Body content for the skill.');
    });

    it('validate rejects a malformed skill source (missing description) before any backup/replace happens', () => {
        const dir = fs.mkdtempSync(path.join(tmpWork, 'skill-source-'));
        fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: broken\n---\nBody with no description field.');
        const targetPath = path.join(tmpWork, 'broken.mdc');
        fs.writeFileSync(targetPath, 'pre-existing content');

        const plan: InstallPlan = {
            operations: [makeOp('broken', {
                type: 'skill', renderer: 'cursor-mdc', output: 'cursor-mdc',
                sourcePath: dir, targetPath,
            })],
            records: [],
            reports: [{ owner: 'cursor', targetPath, action: 'install' }],
        };

        expect(() => applyInstallPlan(plan)).toThrow();
        // No backup/replace should have touched the pre-existing target.
        expect(fs.readFileSync(targetPath, 'utf8')).toBe('pre-existing content');
    });

    it('verify rejects a corrupt/malformed staged .mdc (mirrors the codex-agent-toml malformed-verify case)', () => {
        const sourceDir = makeSkillSource('A sample skill', 'Body content.');
        const targetPath = path.join(tmpWork, 'corrupt.mdc');
        const plan: InstallPlan = {
            operations: [makeOp('corrupt', {
                type: 'skill', renderer: 'cursor-mdc', output: 'cursor-mdc',
                sourcePath: sourceDir, targetPath,
            })],
            records: [],
            reports: [{ owner: 'cursor', targetPath, action: 'install' }],
        };

        const deps = {
            ...defaultTransactionDeps(),
            stage(op: PlannedOperation) {
                const parent = path.dirname(op.targetPath);
                fs.mkdirSync(parent, { recursive: true });
                const staged = path.join(parent, `.${path.basename(op.targetPath)}.corrupt-test.staged`);
                fs.writeFileSync(staged, 'not a valid rendered .mdc file at all');
                return staged;
            },
        };

        expect(() => applyInstallPlan(plan, deps)).toThrow('does not look like rendered Cursor .mdc');
    });

    it('verify rejects a corrupt/malformed staged .instructions.md', () => {
        const sourceDir = makeSkillSource('A sample skill', 'Body content.');
        const targetPath = path.join(tmpWork, 'corrupt.instructions.md');
        const plan: InstallPlan = {
            operations: [makeOp('corrupt', {
                type: 'skill', renderer: 'copilot-instructions', output: 'copilot-instructions',
                sourcePath: sourceDir, targetPath,
            })],
            records: [],
            reports: [{ owner: 'copilot', targetPath, action: 'install' }],
        };

        const deps = {
            ...defaultTransactionDeps(),
            stage(op: PlannedOperation) {
                const parent = path.dirname(op.targetPath);
                fs.mkdirSync(parent, { recursive: true });
                const staged = path.join(parent, `.${path.basename(op.targetPath)}.corrupt-test.staged`);
                fs.writeFileSync(staged, 'not a valid rendered instructions file at all');
                return staged;
            },
        };

        expect(() => applyInstallPlan(plan, deps)).toThrow('does not look like rendered Copilot instructions');
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
        // Windows fs.chmod can only toggle the read-only attribute, not set granular
        // POSIX bits (see tests/core/atomic-file.test.ts for the confirmed 0o600 ->
        // 0o666 file shape on win32, verified against real windows-latest CI). Directory
        // mode is reasoned by the same mechanism but not yet independently confirmed
        // against real Windows CI for THIS exact 0o700 -> 0o777 case -- libuv derives
        // directory mode on win32 by always setting the execute bit for every class
        // (traversal isn't gated by chmod there), so 0o777 is the expected shape for a
        // non-read-only directory; flag for correction if a real CI run disagrees.
        expect(dirMode).toBe(process.platform === 'win32' ? 0o777 : 0o700);
        expect(manifestMode).toBe(process.platform === 'win32' ? 0o666 : 0o600);

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
