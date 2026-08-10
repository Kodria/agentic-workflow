import {
    EXECUTION_STATES, GENERATION_STATES, isWellFormedState, isWellFormedProcessRef, isWellFormedJob, emptyState,
} from '../../../src/core/journal/types';

describe('journal types', () => {
    test('execution states incluyen orphaned y cancel (R1.7)', () => {   // verifies R1.7
        expect(EXECUTION_STATES).toEqual([
            'received', 'spawn-intent', 'claimed', 'running',
            'exited', 'cancel-requested', 'cancelled', 'orphaned',
        ]);
        expect(GENERATION_STATES).toEqual([
            'active', 'controller-suspected-stall', 'terminated', 'superseded',
        ]);
    });

    test('emptyState produce un estado bien formado (R1.4)', () => {     // verifies R1.4
        const s = emptyState('mi-rama');
        expect(isWellFormedState(s)).toBe(true);
        expect(s.schema).toBe(1);
        expect(s.revision).toBe(0);
        expect(s.cycle.status).toBe('IN_PROGRESS');
        expect(typeof s.cycle.startedAt).toBe('string');
        expect(s.cycle.nextAction?.actionId).toBe('bootstrap-cycle');
        expect(s.requiredVerifiers).toEqual([]);
        expect(s.dispatches).toEqual([]);
    });

    test('isWellFormedState rechaza no-objetos y shapes rotos (R1.6)', () => {  // verifies R1.6
        expect(isWellFormedState(null)).toBe(false);
        expect(isWellFormedState(42)).toBe(false);
        expect(isWellFormedState({ schema: 1 })).toBe(false);
        const bad = emptyState('x') as unknown as Record<string, unknown>;
        bad.revision = 'no-un-numero';
        expect(isWellFormedState(bad)).toBe(false);
        const bad2 = emptyState('y') as unknown as Record<string, unknown>;
        delete bad2.requiredVerifiers;
        expect(isWellFormedState(bad2)).toBe(false);
    });

    test('isWellFormedProcessRef exige la tupla COMPLETA (R2.1)', () => {  // verifies R2.1
        const full = { pid: 1, startTime: 'x', spawnNonce: 'n', argvDigest: 'd', processGroup: 1, psArgsDigest: 'p' };
        expect(isWellFormedProcessRef(full)).toBe(true);
        expect(isWellFormedProcessRef({ ...full, psArgsDigest: undefined })).toBe(false);
        expect(isWellFormedProcessRef({ ...full, processGroup: 'uno' })).toBe(false);
        expect(isWellFormedProcessRef(null)).toBe(false);
    });

    test('isWellFormedJob exige TODOS los campos requeridos, no un subset (R1.6)', () => {  // verifies R1.6
        const full = {
            id: 'j1',
            fingerprint: 'f',
            commandDigest: 'c',
            argv: ['x'],
            cwd: '.',
            paths: ['**/*.ts'],
            expandedPaths: ['a.ts'],
            executionState: 'received',
            observationState: 'progressing',
            phaseTimestamps: {},
        };
        expect(isWellFormedJob(full)).toBe(true);
        for (const key of ['paths', 'expandedPaths', 'observationState', 'phaseTimestamps']) {
            const broken = { ...full } as Record<string, unknown>;
            delete broken[key];
            expect(isWellFormedJob(broken)).toBe(false);
        }
        expect(isWellFormedJob({ ...full, phaseTimestamps: [] })).toBe(false);
        expect(isWellFormedJob({ ...full, argv: [42] })).toBe(false);
        expect(isWellFormedJob({ ...full, paths: [{ glob: '**/*' }] })).toBe(false);
        expect(isWellFormedJob({ ...full, observationState: 'stuck' })).toBe(false);
        expect(isWellFormedJob({ ...full, verdict: 'maybe' })).toBe(false);
        expect(isWellFormedJob({ ...full, result: { exitCode: 0 } })).toBe(false);
        expect(isWellFormedJob({ ...full, processRef: { pid: 1 } })).toBe(false);
    });

    test('IN_PROGRESS exige nextAction estructurada y status del ciclo conocido (R1.5/R1.6)', () => {
        const missing = emptyState('x');
        delete missing.cycle.nextAction;
        expect(isWellFormedState(missing)).toBe(false);
        const badStatus = emptyState('x') as unknown as { cycle: { status: string } };
        badStatus.cycle.status = 'FINISHED';
        expect(isWellFormedState(badStatus)).toBe(false);
    });

    test('emptyState genera journalId estable y único (R9.1)', () => {   // verifies R9.1
        const a = emptyState('main');
        const b = emptyState('main');
        expect(a.journalId).toMatch(/^j-[0-9a-f-]{36}$/);
        expect(b.journalId).not.toBe(a.journalId);
    });

    test('isWellFormedState exige journalId no vacio (R9.1)', () => {   // verifies R9.1
        const bad = emptyState('x') as unknown as Record<string, unknown>;
        delete bad.journalId;
        expect(isWellFormedState(bad)).toBe(false);
        bad.journalId = '';
        expect(isWellFormedState(bad)).toBe(false);
    });

    test('TrackRef exige intents y nonces con shape completa (R9.2, R9.7)', () => {  // verifies R9.2, R9.7
        const state = emptyState('main');
        state.tracks = [{
            trackId: 'cli', worktreePath: '/tmp/wt', branch: 'awm-track/cli', ownership: ['cli/'],
            sharedResources: [], dependsOn: [], fencingToken: 'f'.repeat(32), phase: 'DECLARED',
            readinessNonce: 'r'.repeat(32),
        }];
        expect(isWellFormedState(state)).toBe(true);
        state.tracks[0].fencingToken = '';
        expect(isWellFormedState(state)).toBe(false);
        state.tracks[0].fencingToken = 'f'.repeat(32);
        state.tracks[0].readinessNonce = '';
        expect(isWellFormedState(state)).toBe(false);
        state.tracks[0].readinessNonce = 'r'.repeat(32);
        (state.tracks[0] as unknown as Record<string, unknown>).phase = 'NOT_A_PHASE';
        expect(isWellFormedState(state)).toBe(false);
    });

    test('TrackRef y TrackContext rechazan una key requerida AUSENTE, no solo vaciada (R9.2, R9.7)', () => {  // verifies R9.2, R9.7
        const fullTrack: Record<string, unknown> = {
            trackId: 'cli', worktreePath: '/tmp/wt', branch: 'awm-track/cli', ownership: ['cli/'],
            sharedResources: [], dependsOn: [], fencingToken: 'f'.repeat(32), phase: 'DECLARED',
            readinessNonce: 'r'.repeat(32),
        };
        // sanity: la shape completa sigue siendo valida por si misma
        const sane = emptyState('main');
        sane.tracks = [{ ...fullTrack } as never];
        expect(isWellFormedState(sane)).toBe(true);

        for (const key of Object.keys(fullTrack)) {
            const partial = { ...fullTrack };
            delete partial[key];   // key AUSENTE por completo, no ''
            const state = emptyState('main');
            state.tracks = [partial as never];
            expect(isWellFormedState(state)).toBe(false);
        }

        const fullContext: Record<string, unknown> = { trackId: 'cli', taskIds: ['t1'], planDigest: 'd', baseSha: 'abc', planJournalId: 'j-plan' };
        const saneContext = emptyState('main');
        saneContext.trackContext = { ...fullContext } as never;
        expect(isWellFormedState(saneContext)).toBe(true);

        for (const key of Object.keys(fullContext)) {
            const partial = { ...fullContext };
            delete partial[key];
            const state = emptyState('main');
            state.trackContext = partial as never;
            expect(isWellFormedState(state)).toBe(false);
        }
    });

    test('TrackRef valida intents opcionales cuando presentes (R9.2, R9.7)', () => {  // verifies R9.2, R9.7
        const state = emptyState('main');
        state.tracks = [{
            trackId: 'cli', worktreePath: '/tmp/wt', branch: 'awm-track/cli', ownership: ['cli/'],
            sharedResources: [], dependsOn: [], fencingToken: 'f'.repeat(32), phase: 'ARMED',
            readinessNonce: 'r'.repeat(32),
            supervisorIntent: { nonce: 'n', argv: ['awm', 'watch'], claimPath: '/tmp/claim' },
            joinIntent: { expectedPlanHeadSha: 'a', expectedTrackHeadSha: 'b', strategy: 'no-ff' },
            teardownIntent: { worktreePath: '/tmp/wt', branch: 'awm-track/cli' },
        }];
        expect(isWellFormedState(state)).toBe(true);
        (state.tracks[0].supervisorIntent as unknown as Record<string, unknown>).nonce = '';
        expect(isWellFormedState(state)).toBe(false);
    });

    test('trackContext, cohortPhase y trackIntegration validan shape cuando presentes (R9.1, R9.3)', () => {
        const state = emptyState('main');
        state.trackContext = { trackId: 'cli', taskIds: ['t1'], planDigest: 'd', baseSha: 'abc', planJournalId: 'j-plan' };
        state.cohortPhase = 'ACTIVE';
        state.cohortBaseSha = 'abc';
        state.trackIntegration = { argv: ['npm', 'test'], paths: ['**/*.ts'], planDigest: 'd' };
        expect(isWellFormedState(state)).toBe(true);
        (state as unknown as Record<string, unknown>).cohortPhase = 'NOT_A_PHASE';
        expect(isWellFormedState(state)).toBe(false);
    });

    test('requiredVerifiers y VerificationItem aceptan el nuevo kind track-integration (C8)', () => {
        const state = emptyState('main');
        state.requiredVerifiers = ['track-integration'];
        state.cycleVerificationPlan = [{ id: 'v1', kind: 'track-integration' }];
        expect(isWellFormedState(state)).toBe(true);
    });
});
