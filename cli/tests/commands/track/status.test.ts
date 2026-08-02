import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { aggregateTrackStatus, deriveCohortPhase, fingerprintFor } from '../../../src/commands/track/status';
import { computeFingerprint } from '../../../src/core/journal/fingerprint';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { statePath } from '../../../src/core/journal/paths';
import type { JournalState, TrackRef } from '../../../src/core/journal/types';
import { trackRefFixture } from './fixtures';

// R9.5/R9.6: `aggregateTrackStatus` COMPONE el gate de cada journal de track
// leyendolo al momento de necesitarlo — jamas escribe de vuelta al journal
// del plan ni persiste el resultado en el TrackRef.

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd });
}

function gitInitAt(repo: string, branch: string): void {
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-q', '-b', branch);
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'c');
}

describe('aggregateTrackStatus — agregado read-only (R9.5, R9.6)', () => {
    let planRoot: string;
    let trackRoot: string;
    const planBranch = 'main';
    const trackBranch = 'track/cli';

    beforeEach(() => {
        planRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-plan-'));
        trackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-track-'));
        gitInitAt(planRoot, planBranch);
        gitInitAt(trackRoot, trackBranch);
        initJournal(planRoot, planBranch);
        initJournal(trackRoot, trackBranch);
    });
    afterEach(() => {
        fs.rmSync(planRoot, { recursive: true, force: true });
        fs.rmSync(trackRoot, { recursive: true, force: true });
    });

    /** Journal de track que satisface computeTrackGate integramente, con
     *  fingerprints REALES de `trackRoot` (fingerprintFor usa computeFingerprint
     *  de verdad, no un stub inyectado). */
    function writeCompletedTrackJournal(): void {
        const fp = computeFingerprint(trackRoot, ['npm', 'test'], [], '.');
        const s = readJournal(trackRoot, trackBranch).state!;
        s.trackContext = { trackId: 'cli', taskIds: ['T1'], planDigest: 'x', baseSha: 'y', planJournalId: 'j-1' };
        s.requiredVerifiers = ['test', 'sensors'];
        s.tasks.push({
            id: 'T1', title: 't', status: 'done', attempts: 1,
            verificationPlan: [
                { id: 'v1', kind: 'test', satisfiedBy: 'j1' },
                { id: 'v-sensors', kind: 'sensors', satisfiedBy: 'j2' },
            ],
            reviewObligations: [
                { id: 'o-spec', taskId: 'T1', kind: 'spec', verdictId: 'verd-spec' },
                { id: 'o-quality', taskId: 'T1', kind: 'quality', verdictId: 'verd-quality' },
            ],
        });
        const job = (id: string) => ({
            id, fingerprint: fp.fingerprint, commandDigest: fp.commandDigest, argv: ['npm', 'test'], cwd: '.',
            paths: [], expandedPaths: fp.expandedPaths, executionState: 'exited' as const,
            observationState: 'progressing' as const, verdict: 'pass' as const, phaseTimestamps: {},
        });
        s.jobs['j1'] = job('j1');
        s.jobs['j2'] = job('j2');
        s.verdicts.push(
            { id: 'verd-spec', obligationId: 'o-spec', result: 'pass', detail: 'ok', receivedAt: 'now', fingerprint: fp.fingerprint, argv: ['npm', 'test'], paths: [], cwd: '.' },
            { id: 'verd-quality', obligationId: 'o-quality', result: 'pass', detail: 'ok', receivedAt: 'now', fingerprint: fp.fingerprint, argv: ['npm', 'test'], paths: [], cwd: '.' },
        );
        writeJournal(trackRoot, trackBranch, s);
    }

    test('compone journals al leer y no los espeja (R9.5, R9.6)', () => {
        writeCompletedTrackJournal();
        const planState = readJournal(planRoot, planBranch).state!;
        planState.tracks = [trackRefFixture({}, trackRoot)];
        writeJournal(planRoot, planBranch, planState);

        const planBefore = fs.readFileSync(statePath(planRoot, planBranch), 'utf8');
        const currentPlanState: JournalState = readJournal(planRoot, planBranch).state!;

        const out = aggregateTrackStatus(planRoot, currentPlanState);
        expect(out.tracks.cli.gate.pass).toBe(true);
        expect(currentPlanState.tracks![0]).not.toHaveProperty('gate');
        expect(fs.readFileSync(statePath(planRoot, planBranch), 'utf8')).toBe(planBefore);
    });

    test('journal de track corrupto/ausente nunca se descarta en silencio: gate rojo con corrupt-state', () => {
        // ni siquiera se inicializa el journal del segundo track: readJournal
        // sobre un directorio sin state.json => corrupt:true (R1.6).
        const missingTrackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-missing-'));
        try {
            const planState = readJournal(planRoot, planBranch).state!;
            planState.tracks = [trackRefFixture({ trackId: 'ghost', branch: 'track/ghost' }, missingTrackRoot)];
            writeJournal(planRoot, planBranch, planState);

            const out = aggregateTrackStatus(planRoot, readJournal(planRoot, planBranch).state!);
            expect(out.tracks.ghost.gate.pass).toBe(false);
            expect(out.tracks.ghost.gate.reasons).toEqual([{ category: 'corrupt-state', detail: expect.any(String) }]);
        } finally {
            fs.rmSync(missingTrackRoot, { recursive: true, force: true });
        }
    });

    test('journal de track roto (fingerprint stale) reporta gate rojo, no lo esconde', () => {
        writeCompletedTrackJournal();
        // el worktree del track cambia DESPUES de que el job registro su
        // fingerprint: la evidencia queda historica.
        fs.writeFileSync(path.join(trackRoot, 'f.txt'), 'cambiado');

        const planState = readJournal(planRoot, planBranch).state!;
        planState.tracks = [trackRefFixture({}, trackRoot)];
        writeJournal(planRoot, planBranch, planState);

        const out = aggregateTrackStatus(planRoot, readJournal(planRoot, planBranch).state!);
        expect(out.tracks.cli.gate.pass).toBe(false);
        expect(out.tracks.cli.gate.reasons.some((r) => r.category === 'stale-fingerprint')).toBe(true);
    });

    test('sin tracks declarados, el agregado es vacio y el cohort lo dice explicitamente', () => {
        const out = aggregateTrackStatus(planRoot, readJournal(planRoot, planBranch).state!);
        expect(out).toEqual({ cohort: 'sin tracks declarados', tracks: {} });
    });
});

describe('deriveCohortPhase — string de display, no decide protocolo', () => {
    function ref(trackId: string, phase: TrackRef['phase']): TrackRef {
        return trackRefFixture({ trackId, phase }, `/tmp/${trackId}`);
    }

    test('sin tracks: mensaje explicito', () => {
        expect(deriveCohortPhase([])).toBe('sin tracks declarados');
    });

    test('cualquier BLOCKED domina el mensaje, nombrando los ids ordenados', () => {
        const out = deriveCohortPhase([ref('b', 'ACTIVE'), ref('a', 'BLOCKED'), ref('c', 'BLOCKED')]);
        expect(out).toBe('BLOCKED: a, c');
    });

    test('sin BLOCKED, reporta la fase MENOS avanzada como cuello de botella', () => {
        // ARMED antecede a ACTIVE en TRACK_PHASES: el track menos avanzado
        // marca el ritmo de la cohorte, no el mas adelantado.
        const out = deriveCohortPhase([ref('a', 'ACTIVE'), ref('b', 'ARMED')]);
        expect(out).toBe('ARMED (1/2)');
    });

    test('todos en la misma fase: cuenta el total', () => {
        expect(deriveCohortPhase([ref('a', 'ACTIVE'), ref('b', 'ACTIVE')])).toBe('ACTIVE (2/2)');
    });
});

describe('fingerprintFor — espejo de realFingerprintNow cerrado sobre el worktree observado', () => {
    let worktree: string;

    beforeEach(() => {
        worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-fpfor-'));
        gitInitAt(worktree, 'main');
    });
    afterEach(() => { fs.rmSync(worktree, { recursive: true, force: true }); });

    test('coincide con computeFingerprint contra el MISMO worktree que cierra', () => {
        const expected = computeFingerprint(worktree, ['npm', 'test'], [], '.').fingerprint;
        expect(fingerprintFor(worktree)(['npm', 'test'], [], '.')).toBe(expected);
    });

    test('argv invalido (vacio) nunca lanza — se degrada a null, nunca certifica', () => {
        expect(fingerprintFor(worktree)([], [], '.')).toBeNull();
    });

    test('cwd fuera del repo tambien se degrada a null en vez de propagar la excepcion', () => {
        expect(fingerprintFor(worktree)(['npm', 'test'], [], '../fuera')).toBeNull();
    });
});
