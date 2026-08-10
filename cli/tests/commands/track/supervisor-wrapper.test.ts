// Task 8 (R5-T8, Step 5): claim exact-once + identity + readiness sidecars +
// espera read-only al propio TrackRef del plan. Ningún proceso real se
// spawnea (launchWatch es inyectado); el único I/O real es el journal del
// plan y los sidecars bajo `.awm/` del propio worktree (tmpdirs).
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { runSupervisorWrapper } from '../../../src/commands/track/supervisor-wrapper';
import { observeSupervisorFromDisk } from '../../../src/commands/watch/tracks';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { supervisorLockPath } from '../../../src/core/journal/paths';
import { trackRefFixture } from './fixtures';

const NONCE = 'the-real-supervisor-intent-nonce';

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

    function seedTrackRef(phase: 'ARMED' | 'ACTIVE' | 'BLOCKED' | 'JOIN_REQUESTED' | 'FROZEN'): void {
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
            worktreePath, trackId: 'cli', nonce: NONCE, readinessNonce: 'nonce-cli'.padEnd(32, '0'), fencingToken: 'fence',
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
            worktreePath, trackId: 'cli', nonce: NONCE, readinessNonce: 'nonce-cli'.padEnd(32, '0'), fencingToken: 'fence',
            planRoot, planBranch: 'main', pollMs: 5,
            launchWatch: () => {
                fs.mkdirSync(path.dirname(supervisorLockPath(worktreePath)), { recursive: true });
                fs.writeFileSync(supervisorLockPath(worktreePath), '{}');
            },
        });
        expect(first).toBe('active');

        let secondLaunched = false;
        const second = await runSupervisorWrapper({
            worktreePath, trackId: 'cli', nonce: NONCE, readinessNonce: 'nonce-cli'.padEnd(32, '0'), fencingToken: 'fence',
            planRoot, planBranch: 'main', pollMs: 5,
            launchWatch: () => { secondLaunched = true; },
        });
        expect(second).toBe('already-claimed');
        expect(secondLaunched).toBe(false);
    });

    // El wrapper esperaba la IGUALDAD EXACTA con `ACTIVE`, con un poll de 2 s en producción.
    // Eso es una carrera: el plan puede cruzar `ACTIVE` entre dos lecturas y dejar al wrapper
    // esperando para siempre una fase que ya pasó — sin `awm watch`, nadie consume las
    // requests cross-journal del track (empezando por `track-freeze-request`) y la cohorte se
    // traba en el freeze. Se observó al reparar el join: un track podía ir
    // `ARMED -> ACTIVE -> JOIN_REQUESTED` dentro de un mismo `reconcileTracks`.
    test.each(['ACTIVE', 'JOIN_REQUESTED', 'FROZEN'] as const)(
        'lanza watch con el track ya en %s: la condición es monótona, no la igualdad con ACTIVE',
        async (phase) => {
            seedTrackRef(phase);
            let launched: string | null = null;
            const outcome = await runSupervisorWrapper({
                worktreePath, trackId: 'cli', nonce: NONCE, readinessNonce: 'nonce-cli'.padEnd(32, '0'), fencingToken: 'fence',
                planRoot, planBranch: 'main', pollMs: 5,
                launchWatch: (wt) => {
                    launched = wt;
                    fs.mkdirSync(path.dirname(supervisorLockPath(wt)), { recursive: true });
                    fs.writeFileSync(supervisorLockPath(wt), '{}');
                },
            });
            expect(outcome).toBe('active');
            expect(launched).toBe(worktreePath);
        },
    );

    test('si el plan bloquea el track, el wrapper jamás lanza `awm watch` (C1, R4.9)', async () => {
        seedTrackRef('BLOCKED');
        let launched = false;
        const outcome = await runSupervisorWrapper({
            worktreePath, trackId: 'cli', nonce: NONCE, readinessNonce: 'nonce-cli'.padEnd(32, '0'), fencingToken: 'fence',
            planRoot, planBranch: 'main', pollMs: 5,
            launchWatch: () => { launched = true; },
        });
        expect(outcome).toBe('blocked');
        expect(launched).toBe(false);
    });

    test('BLOCKER fix: el nonce recibido viaja al identity sidecar y observeSupervisorFromDisk jamás clasifica un wrapper legítimo como foreign (R4.7, R4.9)', async () => {
        seedTrackRef('ARMED');
        const wrapperPromise = runSupervisorWrapper({
            worktreePath, trackId: 'cli', nonce: NONCE, readinessNonce: 'nonce-cli'.padEnd(32, '0'), fencingToken: 'fence',
            planRoot, planBranch: 'main', pollMs: 5,
            launchWatch: (wt) => {
                fs.mkdirSync(path.dirname(supervisorLockPath(wt)), { recursive: true });
                fs.writeFileSync(supervisorLockPath(wt), '{}');
            },
        });
        // El claim/identity/ready sidecar se escriben ANTES del loop de
        // espera por ACTIVE — no hace falta llegar a ACTIVE para probar el
        // eco del nonce.
        await new Promise((r) => setTimeout(r, 30));

        const identity = JSON.parse(fs.readFileSync(path.join(worktreePath, '.awm', 'supervisor.identity.json'), 'utf8'));
        expect(identity.nonce).toBe(NONCE);   // el wrapper NUNCA genera el suyo propio

        const claimPath = path.join(worktreePath, '.awm', 'supervisor.claim');
        const matchingRef = trackRefFixture(
            { trackId: 'cli', phase: 'SUPERVISOR_STARTING', supervisorIntent: { nonce: NONCE, argv: [], claimPath } },
            worktreePath,
        );
        expect(observeSupervisorFromDisk(matchingRef)).toEqual({ kind: 'ready', readinessNonce: 'nonce-cli'.padEnd(32, '0') });

        const foreignRef = trackRefFixture(
            { trackId: 'cli', phase: 'SUPERVISOR_STARTING', supervisorIntent: { nonce: 'a-completely-different-nonce', argv: [], claimPath } },
            worktreePath,
        );
        expect(observeSupervisorFromDisk(foreignRef).kind).toBe('foreign');

        seedTrackRef('ACTIVE');
        await wrapperPromise;
    });
});
