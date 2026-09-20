import { spawnSync } from 'child_process';
import fs from 'fs';
import { initRepo } from '../../helpers/git-fixture';
import path from 'path';
import { CONTROLLER_AUTONOMIES, adapterFor, controllerAutonomyMapping, isControllerAutonomy } from '../../../src/core/journal/adapter';
import { PROVIDER_EXECUTION_CAPABILITIES, unattendedCapabilities } from '../../../src/core/admission';

// #168: `unattendedController: 'supported'` was a hardcoded constant while
// D-016 explicitly marked "a real LLM can occupy the controller role" as
// UNVERIFIED. Admission authorized native dispatch on that constant, and the
// launch path passed no autonomy posture — so the controller blocked on its
// first tool call and died as a stall. These tests pin both halves.

describe('controller autonomy posture (#168)', () => {
    test('claude-code maps the posture onto the flag its own --help documents', () => {
        const argv = adapterFor('claude-code').launchArgv('resume-next-action', 'approval-free');
        expect(argv.slice(0, 4)).toEqual(['claude', '--permission-mode', 'bypassPermissions', '-p']);
        // The prompt stays the LAST argument, as every adapter promises.
        expect(argv[argv.length - 1]).toContain('resume-next-action');
    });

    test('without a declared posture the launch argv is unchanged — the shipped bug', () => {
        expect(adapterFor('claude-code').launchArgv('resume-next-action')).toEqual([
            'claude', '-p', expect.stringContaining('resume-next-action'),
        ]);
    });

    test('codex declares its mapping unverified rather than inventing a flag', () => {
        // The R0 evidence captured `codex --help`, never `codex exec --help`, so
        // where the approval flag goes on the subcommand is not established.
        expect(controllerAutonomyMapping('codex')).toBe('unverified');
        expect(controllerAutonomyMapping('claude-code')).toBe('verified');
        expect(adapterFor('codex').launchArgv('resume-next-action', 'approval-free'))
            .toEqual(['codex', 'exec', expect.stringContaining('resume-next-action')]);
    });

    test('the posture vocabulary refuses anything it has not measured', () => {
        expect(CONTROLLER_AUTONOMIES).toEqual(['approval-free']);
        for (const invalid of ['acceptEdits', 'bypassPermissions', 'never', '', 'full', undefined, 7]) {
            expect(isControllerAutonomy(invalid)).toBe(false);
        }
        expect(isControllerAutonomy('approval-free')).toBe(true);
    });
});

describe('unattendedController stops being asserted for free (#168)', () => {
    test('degrades to unverified when no posture was declared', () => {
        expect(PROVIDER_EXECUTION_CAPABILITIES['claude-code'].unattendedController).toBe('supported');
        expect(unattendedCapabilities('claude-code', undefined).unattendedController).toBe('unverified');
    });

    test('honours the operator declaration even where AWM injects no flag', () => {
        // AWM cannot verify codex's posture mapping, but the operator may carry
        // approval policy in their own config. Refusing to guess the flag is not
        // the same as refusing the operator — same doctrine as --expected-digest.
        expect(controllerAutonomyMapping('codex')).toBe('unverified');
        expect(unattendedCapabilities('codex', 'approval-free').unattendedController).toBe('supported');
    });

    test('is supported once the posture is declared', () => {
        expect(unattendedCapabilities('claude-code', 'approval-free').unattendedController).toBe('supported');
    });

    test('never promotes a provider that never had the capability', () => {
        expect(PROVIDER_EXECUTION_CAPABILITIES.cursor.unattendedController).toBe('unverified');
        expect(unattendedCapabilities('cursor', 'approval-free').unattendedController).toBe('unverified');
    });
});

describe('awm watch surfaces the posture on the compiled binary (#168)', () => {
    const cli = path.resolve(__dirname, '../../../dist/src/index.js');

    test('declares the flag and its vocabulary', () => {
        const help = spawnSync(process.execPath, [cli, 'watch', '--help'], { encoding: 'utf8', env: { ...process.env, AWM_NO_UPDATE_CHECK: '1' } });
        expect(help.status).toBe(0);
        expect(help.stdout).toContain('--controller-autonomy');
        expect(help.stdout).toContain('approval-free');
    });

    test('refuses a posture it cannot honour instead of launching a controller that stalls', () => {
        // Hermetic repo on a real branch: without a cwd of its own this inherits
        // the checkout, and a detached HEAD makes `currentBranch()` fail first —
        // which is exactly how this test passed locally and failed on all six CI
        // legs. The assertion must depend on the flag, not on ambient git state.
        const repo = initRepo();
        try {
            const result = spawnSync(process.execPath, [cli, 'watch', '--provider', 'claude-code', '--controller-autonomy', 'bypassPermissions'],
                { cwd: repo, encoding: 'utf8', env: { ...process.env, AWM_NO_UPDATE_CHECK: '1' } });
            expect(result.status).toBe(1);
            expect(result.stderr).toContain('--controller-autonomy invalido');
            expect(result.stderr).toContain('approval-free');
        } finally { fs.rmSync(repo, { recursive: true, force: true }); }
    });
});
