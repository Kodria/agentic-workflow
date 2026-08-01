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
});
