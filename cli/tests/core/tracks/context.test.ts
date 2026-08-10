import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import {
    resolveAuthenticatedContext, resolveCommandContext, assertTrackTask, planDigest,
} from '../../../src/core/tracks/context';
import { writeDescriptor, TrackDescriptor } from '../../../src/core/tracks/descriptor';
import { initJournal, writeJournal, readJournal } from '../../../src/core/journal/store';
import { emptyState, JournalState, TrackContext, TrackRef } from '../../../src/core/journal/types';

function gitInit(repo: string): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'init', '-q', '-b', 'main'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'add', '.'], { cwd: repo });
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'c'], { cwd: repo });
}

function descriptorFor(overrides: Partial<TrackDescriptor>, planRoot: string): TrackDescriptor {
    return { schema: 1, planRoot, planBranch: 'main', trackId: 'cli', planJournalId: 'j-1', fencingToken: 'f'.repeat(32), ...overrides };
}

function trackRefFor(overrides: Partial<TrackRef>, worktreePath: string): TrackRef {
    return {
        trackId: 'cli', worktreePath, branch: 'track/cli', ownership: [], sharedResources: [], dependsOn: [],
        fencingToken: 'f'.repeat(32), phase: 'ACTIVE', readinessNonce: 'n'.repeat(8), ...overrides,
    };
}

function planStateWith(journalId: string, fencingToken: string, worktreePath: string): JournalState {
    const s = emptyState('main');
    s.journalId = journalId;
    s.tracks = [trackRefFor({ fencingToken }, worktreePath)];
    return s;
}

function trackStateWith(overrides: Partial<TrackContext> = {}): JournalState {
    const s = emptyState('track/cli');
    s.trackContext = { trackId: 'cli', taskIds: ['1'], planDigest: 'expected', baseSha: 'sha', planJournalId: 'j-1', ...overrides };
    return s;
}

function trackContextFixture(overrides: Partial<TrackContext> = {}): TrackContext {
    return { trackId: 'cli', taskIds: ['1', '2'], planDigest: 'expected', baseSha: 'sha', planJournalId: 'j-1', ...overrides };
}

describe('resolveAuthenticatedContext (R2.5, R2.6, R9.4)', () => {
    let trackRoot: string;
    let otherRoot: string;
    let planRoot: string;

    beforeEach(() => {
        trackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ctx-track-'));
        otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ctx-other-'));
        planRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-ctx-plan-'));
    });

    afterEach(() => {
        for (const dir of [trackRoot, otherRoot, planRoot]) fs.rmSync(dir, { recursive: true, force: true });
    });

    test('sin descriptor => modo plan, devuelve el journal local tal cual', () => {
        const local = emptyState('main');
        expect(resolveAuthenticatedContext(trackRoot, local)).toEqual({ mode: 'plan', repoRoot: fs.realpathSync(trackRoot), journal: local });
    });

    test('descriptor debe coincidir por realpath, journalId y fencing (R2.5, R2.6, R9.4)', () => {
        writeDescriptor(trackRoot, descriptorFor({ planJournalId: 'j-1', fencingToken: 'f'.repeat(32) }, planRoot));
        const local = trackStateWith({ planJournalId: 'j-1', trackId: 'cli' });

        expect(resolveAuthenticatedContext(trackRoot, local, planStateWith('j-1', 'f'.repeat(32), trackRoot))).toMatchObject({ mode: 'track' });
        expect(() => resolveAuthenticatedContext(trackRoot, local, planStateWith('j-1', 'x'.repeat(32), trackRoot))).toThrow(/fencingToken/);

        writeDescriptor(otherRoot, descriptorFor({ planJournalId: 'j-1', fencingToken: 'f'.repeat(32) }, planRoot));
        // el TrackRef del plan sigue apuntando a trackRoot: otherRoot nunca puede autenticarse contra el (R9.4)
        expect(() => resolveAuthenticatedContext(otherRoot, local, planStateWith('j-1', 'f'.repeat(32), trackRoot))).toThrow(/realpath/);
    });

    test('descriptor presente sin trackContext en el journal local lanza', () => {
        writeDescriptor(trackRoot, descriptorFor({}, planRoot));
        const local = emptyState('track/cli');   // sin trackContext
        expect(() => resolveAuthenticatedContext(trackRoot, local, planStateWith('j-1', 'f'.repeat(32), trackRoot)))
            .toThrow(/trackContext/);
    });

    test('journalId del plan divergente del descriptor lanza (planJournalId)', () => {
        writeDescriptor(trackRoot, descriptorFor({ planJournalId: 'j-1' }, planRoot));
        const local = trackStateWith({ planJournalId: 'j-1' });
        expect(() => resolveAuthenticatedContext(trackRoot, local, planStateWith('j-OTRO', 'f'.repeat(32), trackRoot)))
            .toThrow(/planJournalId/);
    });

    test('planJournalId del trackContext local divergente del descriptor tambien lanza', () => {
        writeDescriptor(trackRoot, descriptorFor({ planJournalId: 'j-1' }, planRoot));
        const local = trackStateWith({ planJournalId: 'j-DISTINTO' });
        expect(() => resolveAuthenticatedContext(trackRoot, local, planStateWith('j-1', 'f'.repeat(32), trackRoot)))
            .toThrow(/planJournalId/);
    });

    test('TrackRef ausente en el journal del plan lanza', () => {
        writeDescriptor(trackRoot, descriptorFor({ trackId: 'fantasma', planJournalId: 'j-1' }, planRoot));
        const local = trackStateWith({ planJournalId: 'j-1', trackId: 'fantasma' });
        const plan = planStateWith('j-1', 'f'.repeat(32), trackRoot);   // tracks=[{trackId:'cli',...}], no 'fantasma'
        expect(() => resolveAuthenticatedContext(trackRoot, local, plan)).toThrow(/TrackRef ausente/);
    });

    test('planRoot == cwd (un track no puede autenticarse contra si mismo) lanza como realpath', () => {
        writeDescriptor(planRoot, descriptorFor({ planJournalId: 'j-1' }, planRoot));
        const local = trackStateWith({ planJournalId: 'j-1' });
        expect(() => resolveAuthenticatedContext(planRoot, local, planStateWith('j-1', 'f'.repeat(32), planRoot)))
            .toThrow(/realpath/);
    });

    test('trackId del trackContext local distinto del descriptor lanza (trackId no coincide)', () => {
        writeDescriptor(trackRoot, descriptorFor({ trackId: 'cli', planJournalId: 'j-1' }, planRoot));
        // el TrackRef existe para 'cli' y fencing/realpath calzan, pero el trackContext local declara OTRO trackId
        const local = trackStateWith({ planJournalId: 'j-1', trackId: 'otro-track' });
        expect(() => resolveAuthenticatedContext(trackRoot, local, planStateWith('j-1', 'f'.repeat(32), trackRoot)))
            .toThrow(/trackId no coincide/);
    });
});

describe('assertTrackTask (R2.3, R2.4)', () => {
    test('planDigest divergente bloquea y task ajena se rechaza (R2.3, R2.4)', () => {
        const ctx = trackContextFixture({ taskIds: ['1', '2'], planDigest: 'expected' });
        expect(() => assertTrackTask(ctx, '3', 'expected')).toThrow(/fuera de la asignación/);
        expect(() => assertTrackTask(ctx, '1', 'actual')).toThrow(/planDigest/);
    });

    test('task asignada con planDigest vigente no lanza', () => {
        const ctx = trackContextFixture({ taskIds: ['1', '2'], planDigest: 'expected' });
        expect(() => assertTrackTask(ctx, '1', 'expected')).not.toThrow();
    });
});

describe('planDigest', () => {
    test('normaliza CRLF antes de hashear, para que checkouts con distinto line-ending no diverjan', () => {
        expect(planDigest('a\r\nb\n')).toBe(planDigest('a\nb\n'));
        expect(planDigest('a\nb\n')).not.toBe(planDigest('a\nc\n'));
    });
});

describe('resolveCommandContext (R9.4): guard de entrada para awm job/watch', () => {
    let trackRoot: string;
    let planRoot: string;

    beforeEach(() => {
        trackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-cmdctx-track-'));
        planRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-cmdctx-plan-'));
        gitInit(trackRoot);
        gitInit(planRoot);
    });

    afterEach(() => {
        fs.rmSync(trackRoot, { recursive: true, force: true });
        fs.rmSync(planRoot, { recursive: true, force: true });
    });

    test('sin descriptor => modo plan, SIN leer ningun journal (no lanza aunque no exista journal alguno)', () => {
        expect(resolveCommandContext(trackRoot, 'main')).toEqual({ mode: 'plan' });
    });

    test('descriptor autentica correctamente => modo track', () => {
        initJournal(planRoot, 'main');
        const planState = { ...(readState(planRoot, 'main')) };
        planState.journalId = 'j-1';
        planState.tracks = [trackRefFor({ fencingToken: 'f'.repeat(32) }, trackRoot)];
        writeJournal(planRoot, 'main', planState);

        initJournal(trackRoot, 'track/cli');
        const localState = { ...(readState(trackRoot, 'track/cli')) };
        localState.trackContext = { trackId: 'cli', taskIds: ['1'], planDigest: 'x', baseSha: 'y', planJournalId: 'j-1' };
        writeJournal(trackRoot, 'track/cli', localState);

        writeDescriptor(trackRoot, descriptorFor({ planJournalId: 'j-1', fencingToken: 'f'.repeat(32) }, planRoot));

        const out = resolveCommandContext(trackRoot, 'track/cli');
        expect(out.mode).toBe('track');
    });

    test('descriptor presente pero fencingToken no coincide => rechaza con "cwd no autenticado"', () => {
        initJournal(planRoot, 'main');
        const planState = { ...(readState(planRoot, 'main')) };
        planState.journalId = 'j-1';
        planState.tracks = [trackRefFor({ fencingToken: 'f'.repeat(32) }, trackRoot)];
        writeJournal(planRoot, 'main', planState);

        initJournal(trackRoot, 'track/cli');
        const localState = { ...(readState(trackRoot, 'track/cli')) };
        localState.trackContext = { trackId: 'cli', taskIds: ['1'], planDigest: 'x', baseSha: 'y', planJournalId: 'j-1' };
        writeJournal(trackRoot, 'track/cli', localState);

        writeDescriptor(trackRoot, descriptorFor({ planJournalId: 'j-1', fencingToken: 'x'.repeat(32) }, planRoot));

        expect(() => resolveCommandContext(trackRoot, 'track/cli')).toThrow(/cwd no autenticado/);
    });

    test('descriptor presente pero el journal local aun no existe => rechaza con "cwd no autenticado" (fail-closed)', () => {
        writeDescriptor(trackRoot, descriptorFor({ planJournalId: 'j-1', fencingToken: 'f'.repeat(32) }, planRoot));
        expect(() => resolveCommandContext(trackRoot, 'track/cli')).toThrow(/cwd no autenticado/);
    });
});

function readState(repo: string, branch: string): JournalState {
    const r = readJournal(repo, branch);
    if (r.state === null) throw new Error('journal no inicializado en el fixture de test');
    return r.state;
}
