import fs from 'fs';
import path from 'path';
import { initRepo, commitFile } from '../../helpers/git-fixture';
import { reconcileTracks, defaultTrackRuntime, type TrackRuntime } from '../../../src/commands/watch/tracks';
import { consumePendingRequests } from '../../../src/commands/watch/apply';
import { emitTrackRequest } from '../../../src/commands/track/emit';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { eventsPath } from '../../../src/core/journal/paths';
import type { JournalState, TrackRef } from '../../../src/core/journal/types';
import type { TrackPhase } from '../../../src/core/tracks/types';

const BRANCH = 'main';

describe('awm track remove -> fallback teardown', () => {
    let planRoot: string;
    let baseSha: string;
    beforeEach(() => {
        planRoot = initRepo();
        commitFile(planRoot, '.gitignore', '.awm/\n');
        baseSha = commitFile(planRoot, 'seed.txt', 'seed');
        initJournal(planRoot, BRANCH);
    });
    afterEach(() => fs.rmSync(planRoot, { recursive: true, force: true }));

    function declareCohort(cohortPhase: JournalState['cohortPhase'] = 'ACTIVE'): JournalState {
        const state = readJournal(planRoot, BRANCH).state!;
        state.cohortPhase = cohortPhase;
        state.cohortBaseSha = baseSha;
        state.tracks = ['a', 'b'].map((trackId): TrackRef => ({
            trackId, worktreePath: path.join(planRoot, `../nope-${trackId}`), branch: `awm-track/${trackId}`,
            ownership: [], sharedResources: [], dependsOn: [], fencingToken: `fence-${trackId}`.padEnd(32, '0'),
            phase: 'ACTIVE' as TrackPhase, readinessNonce: `ready-${trackId}`.padEnd(32, '0'),
        }));
        writeJournal(planRoot, BRANCH, state);
        return readJournal(planRoot, BRANCH).state!;
    }
    function inertRuntime(): TrackRuntime {
        const real = defaultTrackRuntime(planRoot, BRANCH);
        return { ...real,
            addWorktree: () => { throw new Error('no external mutation expected'); },
            initTrackJournal: () => { throw new Error('no external mutation expected'); },
            spawnSupervisor: () => { throw new Error('no external mutation expected'); },
            stopOwnSupervisor: () => { throw new Error('no external mutation expected'); },
            removeOwnedWorktree: () => { throw new Error('no external mutation expected'); },
            removeOwnedBranch: () => { throw new Error('no external mutation expected'); },
        };
    }
    function events(): Array<Record<string, unknown>> {
        if (!fs.existsSync(eventsPath(planRoot, BRANCH))) return [];
        return fs.readFileSync(eventsPath(planRoot, BRANCH), 'utf8').trim().split('\n').filter(Boolean)
            .map((line) => JSON.parse(line));
    }

    it('consume el marker antes que join y persiste fallback cohort-wide (TR-REQ-03, TR-REQ-04)', async () => {
        const state = declareCohort();
        state.tracks![0].joinRequested = true;
        writeJournal(planRoot, BRANCH, state);
        emitTrackRequest(planRoot, BRANCH, 'g1', 'track-teardown-request', 'b');
        consumePendingRequests(planRoot, BRANCH, 'g1');
        const out = await reconcileTracks(planRoot, BRANCH, readJournal(planRoot, BRANCH).state!, inertRuntime(), 2);
        expect(out.state.cohortPhase).toBe('FALLBACK_PENDING');
        // Consumir el marcador es su propia frontera durable: el teardown
        // empieza recién en la siguiente llamada.
        expect(out.effectExecuted).toBeNull();
        expect(out.state.cohortFallbackReason).toBe('controller-requested:b');
        expect(out.state.tracks?.find((track) => track.trackId === 'b')?.teardownRequested)
            .toBeUndefined();
        expect(events().some((event) => event.kind === 'track-teardown-observed' && event.trackId === 'b'))
            .toBe(true);
    });
    it('un marker sobreviviente a restart converge por el mismo reducer (TR-REQ-07)', async () => {
        const state = declareCohort();
        state.tracks![0].teardownRequested = true;
        writeJournal(planRoot, BRANCH, state);
        const out = await reconcileTracks(planRoot, BRANCH, readJournal(planRoot, BRANCH).state!, inertRuntime(), 2);
        expect(out.state.cohortPhase).toBe('FALLBACK_PENDING'); expect(out.state.tracks![0].teardownRequested).toBeUndefined();
    });
    it.each(['SERIAL', 'COMPLETE'] as const)('consume remove tardío como moot en %s (TR-REQ-09)', async (phase) => {
        const state = declareCohort(phase);
        for (const track of state.tracks!) { track.phase = phase === 'SERIAL' ? 'REMOVED' : 'JOINED'; track.frozenHeadSha = phase === 'COMPLETE' ? baseSha : undefined; }
        state.tracks![0].teardownRequested = true; writeJournal(planRoot, BRANCH, state);
        const out = await reconcileTracks(planRoot, BRANCH, readJournal(planRoot, BRANCH).state!, inertRuntime(), 2);
        expect(out.state.cohortPhase).toBe(phase); expect(out.state.tracks![0].teardownRequested).toBeUndefined();
        expect(events()).toContainEqual(expect.objectContaining({ kind: 'track-teardown-moot', trackId: 'a', phase }));
    });
    it('una request en cohorte BLOCKED es moot y no reabre fallback', async () => {
        const state = declareCohort('BLOCKED');
        state.tracks![0].phase = 'BLOCKED';
        state.tracks![1].phase = 'REMOVED';
        state.tracks![1].teardownRequested = true;
        writeJournal(planRoot, BRANCH, state);
        const out = await reconcileTracks(planRoot, BRANCH, readJournal(planRoot, BRANCH).state!, inertRuntime(), 2);
        expect(out.effectExecuted).toBeNull(); expect(out.state.cohortPhase).toBe('BLOCKED'); expect(out.state.tracks![1].teardownRequested).toBeUndefined();
        expect(events()).toContainEqual(expect.objectContaining({ kind: 'track-teardown-moot', trackId: 'b', phase: 'BLOCKED' }));
    });

    it('consume exactamente un marcador de teardown por reconcile antes de begin-teardown (issue #93)', async () => {
        const s = declareCohort('ACTIVE');
        s.tracks!.forEach((track) => { track.teardownRequested = true; });
        writeJournal(planRoot, BRANCH, s);

        const first = await reconcileTracks(planRoot, BRANCH, readJournal(planRoot, BRANCH).state!, inertRuntime(), 2);
        expect(first.effectExecuted).toBeNull();
        expect(first.state.tracks?.find((track) => track.trackId === 'a')?.teardownRequested).toBeUndefined();
        expect(first.state.tracks?.find((track) => track.trackId === 'b')?.teardownRequested).toBe(true);

        const second = await reconcileTracks(planRoot, BRANCH, first.state, inertRuntime(), 2);
        expect(second.effectExecuted).toBeNull();
        expect(second.state.tracks?.every((track) => track.teardownRequested === undefined)).toBe(true);
    });

    it('una request repetida durante teardown no rebobina fases ni ejecuta trabajo destructivo (issue #93)', async () => {
        declareCohort('ACTIVE');
        emitTrackRequest(planRoot, BRANCH, 'g1', 'track-teardown-request', 'a');
        consumePendingRequests(planRoot, BRANCH, 'g1');
        const afterFirst = await reconcileTracks(planRoot, BRANCH, readJournal(planRoot, BRANCH).state!, inertRuntime(), 2);

        emitTrackRequest(planRoot, BRANCH, 'g2', 'track-teardown-request', 'a');
        consumePendingRequests(planRoot, BRANCH, 'g2');
        const repeated = await reconcileTracks(planRoot, BRANCH, readJournal(planRoot, BRANCH).state!, inertRuntime(), 2);

        expect(afterFirst.state.tracks?.find((track) => track.trackId === 'a')?.phase).toBe('TEARDOWN_REQUESTED');
        expect(repeated.effectExecuted).toBeNull();
        expect(repeated.state.tracks?.find((track) => track.trackId === 'a')?.phase).toBe('TEARDOWN_REQUESTED');
        expect(repeated.state.cohortPhase).toBe('FALLBACK_PENDING');
    });

    it('request durante FINAL_INTERLOCK persiste fallback sin evidencia final stale (issue #93)', async () => {
        const s = declareCohort('FINAL_INTERLOCK');
        for (const track of s.tracks!) track.phase = 'MERGED_UNVERIFIED';
        for (const track of s.tracks!) track.frozenHeadSha = `${track.trackId}-head`;
        s.globalQaHeadSha = 'qa-head';
        s.finalIntegrationJobId = 'integration-job';
        s.qaFinalizeRequested = { headSha: 'qa-head', at: new Date().toISOString() };
        writeJournal(planRoot, BRANCH, s);
        emitTrackRequest(planRoot, BRANCH, 'g1', 'track-teardown-request', 'a');
        consumePendingRequests(planRoot, BRANCH, 'g1');

        let releases = 0;
        const runtime = { ...inertRuntime(), releaseIntegrationLockIfHeld: () => { releases += 1; } };
        const out = await reconcileTracks(planRoot, BRANCH, readJournal(planRoot, BRANCH).state!, runtime, 2);
        const durable = readJournal(planRoot, BRANCH).state!;

        expect(out.state.cohortPhase).toBe('FALLBACK_PENDING');
        expect(durable.globalQaHeadSha).toBeUndefined();
        expect(durable.finalIntegrationJobId).toBeUndefined();
        expect(durable.qaFinalizeRequested).toBeUndefined();
        expect(durable.tracks?.every((track) => track.phase === 'TEARDOWN_REQUESTED')).toBe(true);
        expect(releases).toBe(1);
    });

    it('un probe de branch indemostrable detiene teardown sin serializar (issue #93)', async () => {
        const s = declareCohort('FALLBACK_PENDING');
        s.tracks![0].phase = 'WORKTREE_REMOVED';
        s.tracks![1].phase = 'REMOVED';
        writeJournal(planRoot, BRANCH, s);
        const gitDir = path.join(planRoot, '.git');
        fs.renameSync(gitDir, `${gitDir}.unavailable`);

        await expect(reconcileTracks(planRoot, BRANCH, s, defaultTrackRuntime(planRoot, BRANCH), 2)).rejects.toThrow(/indemostrable/);

        fs.renameSync(`${gitDir}.unavailable`, gitDir);
        const durable = readJournal(planRoot, BRANCH).state!;
        expect(durable.cohortPhase).toBe('FALLBACK_PENDING');
        expect(durable.tracks?.find((track) => track.trackId === 'a')?.phase).toBe('WORKTREE_REMOVED');
    });
});
