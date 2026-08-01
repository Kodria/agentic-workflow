import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { buildExport } from '../../../src/commands/job/export';
import { emptyState, Job } from '../../../src/core/journal/types';

function job(partial: Partial<Job>): Job {
    return {
        id: 'j1', fingerprint: 'fp', commandDigest: 'cd', argv: ['npm', 'test'], cwd: '.',
        paths: [], expandedPaths: [], executionState: 'exited', observationState: 'progressing',
        phaseTimestamps: {}, ...partial,
    };
}

describe('export', () => {
    let logs: string;
    beforeEach(() => { logs = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-exp-')); });
    afterEach(() => { fs.rmSync(logs, { recursive: true, force: true }); });

    test('schema, timestamps por fase, wall time por task y ciclo (R3.7 / RNF-T.4)', () => {  // verifies R3.7
        const s = emptyState('r');
        s.cycle.startedAt = '2026-08-01T10:00:00.000Z';
        s.cycle.completedAt = '2026-08-01T10:30:00.000Z';
        s.tasks.push({ id: 'T1', title: 't', status: 'done', attempts: 2, verificationPlan: [], reviewObligations: [], createdAt: '2026-08-01T10:00:00.000Z', completedAt: '2026-08-01T10:10:00.000Z' });
        s.tasks.push({ id: 'T2', title: 'sin-timestamps', status: 'done', attempts: 1, verificationPlan: [], reviewObligations: [] });
        s.jobs['j1'] = job({ phaseTimestamps: { received: 'a', running: 'b', exited: 'c' } });
        const e = buildExport(s, 'codex', { logsRoot: null, baseline: null });
        expect(e.schema).toBe(2);
        expect(e.cycle.wallTimeMs).toBe(30 * 60000);
        expect(e.tasks[0].wallTimeMs).toBe(10 * 60000);
        expect(e.tasks[1].wallTimeMs).toBe('unobservable');           // sin timestamps => declarado, no cero
        expect(e.jobs[0].phaseTimestamps.running).toBe('b');
    });

    test('despachos REALES, dedup real, evidencia con hash + comando reproducible (RNF-T.8/T.9)', () => {  // verifies R3.7
        const s = emptyState('r');
        s.dispatches.push({ id: 'd1', taskId: 'T1', at: 'x' }, { id: 'd2', taskId: 'T1', at: 'y' });
        s.jobs['j1'] = job({ id: 'j1', spawnNonce: 'n1' });
        s.jobs['j2'] = job({ id: 'j2', spawnNonce: 'n2' });           // mismo fingerprint+cmd => dedup
        const resultBody = JSON.stringify({ exitCode: 0, endedAt: 'x', resultPath: 'p' });
        fs.writeFileSync(path.join(logs, 'j1.n1.result.json'), resultBody);
        const e = buildExport(s, 'codex', { logsRoot: logs, baseline: null });
        expect(e.metrics.dispatches).toBe(2);                          // reales, no attempts-proxy
        expect(e.metrics.mechanicalRunsReal).toBe(2);
        expect(e.metrics.mechanicalRunsDeduplicated).toBe(1);
        expect(e.jobs.find((j) => j.id === 'j2')!.deduplicated).toBe(true);
        const ev1 = e.evidence.find((x) => x.jobId === 'j1')!;
        expect(ev1.resultHash).toBe(crypto.createHash('sha256').update(resultBody).digest('hex'));
        expect(ev1.reproduce).toContain('npm test');
        expect(e.evidence.find((x) => x.jobId === 'j2')!.resultHash).toBe('unobservable');  // sin result file
    });

    test('baselineComparison: con baseline compara, sin baseline declara unobservable (R3.7)', () => {  // verifies R3.7
        const s = emptyState('r');
        s.cycle.startedAt = '2026-08-01T10:00:00.000Z';
        s.cycle.completedAt = '2026-08-01T10:20:00.000Z';
        s.dispatches.push({ id: 'd1', taskId: 'T1', at: 'x' });
        const withBase = buildExport(s, 'codex', { logsRoot: null, baseline: { source: 'docs/baseline-2026-07-29.json', wallTimeMs: 40 * 60000, dispatches: 3 } });
        expect(withBase.baselineComparison.baselineDate).toBe('2026-07-29');
        expect(withBase.baselineComparison.wallTimeMs).toEqual({ current: 20 * 60000, baseline: 40 * 60000, delta: -20 * 60000 });
        expect(withBase.baselineComparison.dispatches).toEqual({ current: 1, baseline: 3, delta: -2 });
        expect(withBase.baselineComparison.tokensPerRole).toBe('unobservable');  // ningun provider lo reporta (R0)
        const noBase = buildExport(s, 'codex', { logsRoot: null, baseline: null });
        expect(noBase.baselineComparison.wallTimeMs.baseline).toBe('unobservable');
        expect(noBase.baselineComparison.wallTimeMs.delta).toBe('unobservable');
        expect(noBase.metrics.tokensPerRole).toBe('unobservable');
    });

    test('wallMs declara unobservable ante timestamps invertidos, nunca un numero negativo (R3.7)', () => {  // verifies R3.7
        const s = emptyState('r');
        s.cycle.startedAt = '2026-08-01T10:30:00.000Z';
        s.cycle.completedAt = '2026-08-01T10:00:00.000Z';   // invertido: dato corrupto/anomalo
        const e = buildExport(s, 'codex', { logsRoot: null, baseline: null });
        expect(e.cycle.wallTimeMs).toBe('unobservable');
    });
});
