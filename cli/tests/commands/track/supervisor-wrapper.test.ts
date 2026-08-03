// Task 8 (R5-T8, Step 5): claim exact-once + identity + readiness sidecars +
// espera read-only al propio TrackRef del plan. Ningún proceso real se
// spawnea (launchWatch es inyectado); el único I/O real es el journal del
// plan y los sidecars bajo `.awm/` del propio worktree (tmpdirs).
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { runSupervisorWrapper } from '../../../src/commands/track/supervisor-wrapper';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { supervisorLockPath } from '../../../src/core/journal/paths';
import { trackRefFixture } from './fixtures';

function git(repo: string, args: string[]): void {
    execFileSync('git', args, { cwd: repo });
}

function gitInit(repo: string, branch: string): void {
    git(repo, ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'init', '-q', '-b', branch]);
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    git(repo, ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'add', '.']);
    git(repo, ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'c']);
}

describe('runSupervisorWrapper — claim exact-once + espera read-only del ACTIVE (R4.7-R4.10, C11)', () => {
    let planRoot: string;
    let worktreePath: string;

    beforeEach(() => {
        planRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-wrapper-plan-'));
        worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-wrapper-wt-'));
        gitInit(planRoot, 'main');
        gitInit(worktreePath, 'awm-track/cli');
        initJournal(planRoot, 'main');
    });

    afterEach(() => {
        fs.rmSync(planRoot, { recursive: true, force: true });
        fs.rmSync(worktreePath, { recursive: true, force: true });
    });

    function seedTrackRef(phase: 'ARMED' | 'ACTIVE' | 'BLOCKED'): void {
        const s = readJournal(planRoot, 'main').state!;
        s.tracks = [
            trackRefFixture({ trackId: 'cli', phase, readinessNonce: 'nonce-cli'.padEnd(32, '0') }, worktreePath),
            trackRefFixture({ trackId: 'docs', phase: 'ACTIVE' }, worktreePath),
        ];
        writeJournal(planRoot, 'main', s);
    }

    test('claim exact-once: identity + readiness sidecars, espera ACTIVE, lanza watch y espera el lock (R4.7, R4.8)', async () => {
        seedTrackRef('ARMED');
        let launched: string | null = null;
        const wrapperPromise = runSupervisorWrapper({
            worktreePath, trackId: 'cli', readinessNonce: 'nonce-cli'.padEnd(32, '0'), fencingToken: 'fence',
            planRoot, planBranch: 'main', pollMs: 5,
            launchWatch: (wt) => {
                launched = wt;
                fs.mkdirSync(path.dirname(supervisorLockPath(wt)), { recursive: true });
                fs.writeFileSync(supervisorLockPath(wt), '{}');
            },
        });
        // Todavía ARMED: el wrapper debe seguir esperando (no lanza watch).
        await new Promise((r) => setTimeout(r, 30));
        expect(launched).toBeNull();

        seedTrackRef('ACTIVE');
        const outcome = await wrapperPromise;

        expect(outcome).toBe('active');
        expect(launched).toBe(worktreePath);
        expect(fs.existsSync(path.join(worktreePath, '.awm', 'supervisor.claim'))).toBe(true);
        const identity = JSON.parse(fs.readFileSync(path.join(worktreePath, '.awm', 'supervisor.identity.json'), 'utf8'));
        expect(identity.trackId).toBe('cli');
        const ready = JSON.parse(fs.readFileSync(path.join(worktreePath, '.awm', 'supervisor.ready.json'), 'utf8'));
        expect(ready.readinessNonce).toBe('nonce-cli'.padEnd(32, '0'));
    });

    test('un segundo wrapper con el mismo claim detecta el claim existente y sale sin lanzar otro supervisor (C11)', async () => {
        seedTrackRef('ACTIVE');
        const first = await runSupervisorWrapper({
            worktreePath, trackId: 'cli', readinessNonce: 'nonce-cli'.padEnd(32, '0'), fencingToken: 'fence',
            planRoot, planBranch: 'main', pollMs: 5,
            launchWatch: () => {
                fs.mkdirSync(path.dirname(supervisorLockPath(worktreePath)), { recursive: true });
                fs.writeFileSync(supervisorLockPath(worktreePath), '{}');
            },
        });
        expect(first).toBe('active');

        let secondLaunched = false;
        const second = await runSupervisorWrapper({
            worktreePath, trackId: 'cli', readinessNonce: 'nonce-cli'.padEnd(32, '0'), fencingToken: 'fence',
            planRoot, planBranch: 'main', pollMs: 5,
            launchWatch: () => { secondLaunched = true; },
        });
        expect(second).toBe('already-claimed');
        expect(secondLaunched).toBe(false);
    });

    test('si el plan bloquea el track, el wrapper jamás lanza `awm watch` (C1, R4.9)', async () => {
        seedTrackRef('BLOCKED');
        let launched = false;
        const outcome = await runSupervisorWrapper({
            worktreePath, trackId: 'cli', readinessNonce: 'nonce-cli'.padEnd(32, '0'), fencingToken: 'fence',
            planRoot, planBranch: 'main', pollMs: 5,
            launchWatch: () => { launched = true; },
        });
        expect(outcome).toBe('blocked');
        expect(launched).toBe(false);
    });
});
