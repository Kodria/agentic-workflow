import fs from 'fs';
import path from 'path';
import os from 'os';
import { consumePendingRequests } from '../../../src/commands/watch/apply';
import { emitRequest } from '../../../src/core/journal/requests';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { requestsDir, eventsPath } from '../../../src/core/journal/paths';
import * as atomicFile from '../../../src/core/atomic-file';
import { computeGate } from '../../../src/commands/job/gate';

function jobPayload(argv: string[]): Record<string, unknown> {
    return { argv, paths: [], cwd: '.', fingerprint: 'fp-1', commandDigest: 'cd-1', expandedPaths: [] };
}

function verdictPayload(verdictId: string, obligationId: string, result: 'pass' | 'fail' | 'inconclusive', detail: string): Record<string, unknown> {
    return { verdictId, obligationId, result, detail, fingerprint: 'fp-review', argv: ['awm-review', obligationId], paths: [], cwd: '.' };
}

describe('aplicacion transaccional de requests', () => {
    let repo: string;
    beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-apply-')); initJournal(repo, 'rama'); });
    afterEach(() => { fs.rmSync(repo, { recursive: true, force: true }); });

    test('orden estado->journal->borrado; replay tras crash NO re-aplica (R1.3)', () => {  // verifies R1.3
        const r1 = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k1', payload: jobPayload(['npm', 'test']) });
        const file = r1.file;
        const savedBody = fs.readFileSync(file, 'utf8');       // copia para simular crash pre-borrado
        const out1 = consumePendingRequests(repo, 'rama', 'g1');
        expect(out1.applied).toBe(1);
        expect(fs.existsSync(file)).toBe(false);               // borrado DESPUES del journal
        const s1 = readJournal(repo, 'rama').state!;
        expect(Object.keys(s1.jobs)).toHaveLength(1);
        expect(s1.appliedRequests[r1.requestId].resultRef).toBe(Object.keys(s1.jobs)[0]);
        // CRASH SIMULADO: el journal persistio pero el archivo NO se borro — lo restauramos
        fs.writeFileSync(file, savedBody);
        const out2 = consumePendingRequests(repo, 'rama', 'g1');
        expect(out2.applied).toBe(0);                          // requestId ya registrado: no re-aplica
        expect(fs.existsSync(file)).toBe(false);               // solo borra
        expect(Object.keys(readJournal(repo, 'rama').state!.jobs)).toHaveLength(1);  // sin duplicados
    });

    test('register-entity CREA task con VerificationPlan y ReviewObligations; cycle-plan y dispatch (R1.4/R1.4b)', () => {  // verifies R1.4b
        emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1',
            payload: {
                entity: 'task', taskId: 'T1', title: 'implementar',
                verificationPlan: [{ id: 'v1', kind: 'test' }],
                reviewObligations: [{ id: 'o1', kind: 'spec' }],
            },
        });
        emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e2',
            payload: { entity: 'cycle-plan', items: [{ id: 'cv1', kind: 'qa' }] },
        });
        emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e3',
            payload: { entity: 'dispatch', dispatchId: 'd1', taskId: 'T1' },
        });
        consumePendingRequests(repo, 'rama', 'g1');
        const s = readJournal(repo, 'rama').state!;
        expect(s.tasks).toHaveLength(1);
        expect(s.tasks[0].verificationPlan).toEqual([{ id: 'v1', kind: 'test' }]);
        expect(s.tasks[0].reviewObligations).toEqual([{ id: 'o1', taskId: 'T1', kind: 'spec' }]);
        expect(s.tasks[0].status).toBe('pending');
        expect(typeof s.tasks[0].createdAt).toBe('string');
        expect(s.cycleVerificationPlan).toEqual([{ id: 'cv1', kind: 'qa' }]);
        expect(s.dispatches).toHaveLength(1);
        expect(s.tasks[0].attempts).toBe(1);                    // dispatch real incrementa attempts
    });

    test('verdict adverso crea Verdict + FixObligation en la MISMA escritura (R1.4c)', () => {  // verifies R1.4c
        emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1',
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [], reviewObligations: [{ id: 'o1', kind: 'spec' }] },
        });
        consumePendingRequests(repo, 'rama', 'g1');
        const revBefore = readJournal(repo, 'rama').state!.revision;
        emitRequest(repo, 'rama', {
            kind: 'verdict', generationToken: 'g1', idempotencyKey: 'e2',
            payload: verdictPayload('verd-1', 'o1', 'fail', 'rompe X'),
        });
        consumePendingRequests(repo, 'rama', 'g1');
        const s = readJournal(repo, 'rama').state!;
        expect(s.revision).toBe(revBefore + 1);                 // UNA escritura para verdict + fix
        expect(s.verdicts).toHaveLength(1);
        expect(s.fixes).toEqual([{ id: 'fix-verd-1', verdictId: 'verd-1', closed: false }]);
        expect(s.tasks[0].reviewObligations[0].verdictId).toBe('verd-1');
    });

    test('job-request enlaza satisfies con el item del plan (R1.4c)', () => {  // verifies R1.4c
        emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1',
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [{ id: 'v1', kind: 'test' }], reviewObligations: [] },
        });
        emitRequest(repo, 'rama', {
            kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k1',
            payload: { ...jobPayload(['npm', 'test']), satisfies: 'v1' },
        });
        consumePendingRequests(repo, 'rama', 'g1');
        const s = readJournal(repo, 'rama').state!;
        const jobId = Object.keys(s.jobs)[0];
        expect(s.tasks[0].verificationPlan[0].satisfiedBy).toBe(jobId);
        expect(s.jobs[jobId].satisfies).toBe('v1');
    });

    test('fencing: token de generacion vieja => rejected-stale-generation auditado (R4.6)', () => {  // verifies R4.6
        emitRequest(repo, 'rama', { kind: 'controller-heartbeat', generationToken: 'g-vieja', idempotencyKey: 'hb1', payload: {} });
        const out = consumePendingRequests(repo, 'rama', 'g-nueva');
        expect(out.rejectedStale).toBe(1);
        const s = readJournal(repo, 'rama').state!;
        expect(Object.values(s.appliedRequests).some((a) => a.outcome === 'rejected-stale-generation')).toBe(true);
        expect(s.controllerHeartbeatAt).toBeUndefined();
    });

    test('request corrupta se aparta VISIBLE como .corrupt, jamas se descarta (R1.6)', () => {  // verifies R1.6
        fs.writeFileSync(path.join(requestsDir(repo, 'rama'), 'req-roto.json'), '{no-json');
        const out = consumePendingRequests(repo, 'rama', 'g1');
        expect(out.corrupt).toBe(1);
        const files = fs.readdirSync(requestsDir(repo, 'rama'));
        expect(files.some((f) => f.endsWith('.corrupt'))).toBe(true);
        const state = readJournal(repo, 'rama').state!;
        expect((state as unknown as { requestProblems: unknown[] }).requestProblems).toHaveLength(1);
        const gate = computeGate(state, false, () => 'fp-1');
        expect(gate.reasons.some((r) => (r.category as string) === 'request-problem')).toBe(true);
    });

    test('reutiliza un job mecanicamente identico para dos items sin digest mismatch ni segunda ejecucion', () => {
        emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'task',
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [{ id: 'v1', kind: 'test' }, { id: 'v2', kind: 'test' }], reviewObligations: [] },
        });
        emitRequest(repo, 'rama', {
            kind: 'job-request', generationToken: 'g1', idempotencyKey: 'job:v1',
            payload: { ...jobPayload(['npm', 'test']), satisfies: 'v1' },
        });
        consumePendingRequests(repo, 'rama', 'g1');
        emitRequest(repo, 'rama', {
            kind: 'job-request', generationToken: 'g1', idempotencyKey: 'job:v2',
            payload: { ...jobPayload(['npm', 'test']), satisfies: 'v2' },
        });
        const out = consumePendingRequests(repo, 'rama', 'g1');
        const state = readJournal(repo, 'rama').state!;
        expect(out.rejectedDigest).toBe(0);
        expect(Object.keys(state.jobs)).toHaveLength(1);
        expect(state.tasks[0].verificationPlan.map((item) => item.satisfiedBy)).toEqual([Object.keys(state.jobs)[0], Object.keys(state.jobs)[0]]);
    });

    test('kind no reconocido (sintacticamente valido) se trata como corrupt, jamas se descarta en silencio (R1.6)', () => {  // verifies R1.6
        const r = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k1', payload: jobPayload(['npm', 'test']) });
        // simula un kind forward-incompatible/corrupto pero JSON sintacticamente valido
        const raw = JSON.parse(fs.readFileSync(r.file, 'utf8'));
        raw.kind = 'kind-desconocido-xyz';
        fs.writeFileSync(r.file, JSON.stringify(raw, null, 2) + '\n');

        const out = consumePendingRequests(repo, 'rama', 'g1');
        expect(out).toEqual({ applied: 0, rejectedStale: 0, rejectedDigest: 0, rejectedInvalid: 0, corrupt: 1 });   // NUNCA "applied: 1" silencioso
        expect(fs.existsSync(r.file)).toBe(false);                          // el .json original ya no esta
        const files = fs.readdirSync(requestsDir(repo, 'rama'));
        expect(files.some((f) => f.endsWith('.corrupt'))).toBe(true);       // visible, jamas descartado

        const s = readJournal(repo, 'rama').state!;
        expect(s.appliedRequests[r.requestId]).toBeUndefined();             // NO se contamina con 'applied'

        const events = fs.readFileSync(eventsPath(repo, 'rama'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        expect(events.some((e) => e.kind === 'request-corrupt')).toBe(true);
    });

    test('batch solo-corrupt igual hace fsync del directorio (durabilidad del rename a .corrupt)', () => {
        fs.writeFileSync(path.join(requestsDir(repo, 'rama'), 'req-roto.json'), '{no-json');
        const spy = jest.spyOn(atomicFile, 'fsyncDirSync');
        const out = consumePendingRequests(repo, 'rama', 'g1');
        expect(out.corrupt).toBe(1);
        expect(spy).toHaveBeenCalledWith(requestsDir(repo, 'rama'));
        spy.mockRestore();
    });

    // ---- post-implementation-qa: fixes 1-8 (cluster apply.ts/requests.ts/job/index.ts/types.ts) ----

    test('Fix1: idempotencyKey reutilizada con payload distinto NO tira — se aplica la primera, se rechaza la segunda como rejected-digest-mismatch, sin wedge', () => {  // verifies bloqueador QA Fix1
        const r1 = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'dup-key', payload: jobPayload(['npm', 'test']) });
        const r2 = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'dup-key', payload: jobPayload(['npm', 'run', 'otro']) });
        const out = consumePendingRequests(repo, 'rama', 'g1');
        expect(out).toEqual({ applied: 1, rejectedStale: 0, rejectedDigest: 1, rejectedInvalid: 0, corrupt: 0 });
        expect(fs.existsSync(r1.file)).toBe(false);
        expect(fs.existsSync(r2.file)).toBe(false);
        expect(fs.readdirSync(requestsDir(repo, 'rama'))).toHaveLength(0);   // nada colgado — jamas wedge
        const s = readJournal(repo, 'rama').state!;
        expect(Object.keys(s.jobs)).toHaveLength(1);
        expect(s.appliedRequests[r2.requestId].outcome).toBe('rejected-digest-mismatch');
        expect(() => consumePendingRequests(repo, 'rama', 'g1')).not.toThrow();   // segunda vuelta: sin re-crash
    });

    test('Fix1 Parte C: un error de validacion inesperado en applyRequestToState NO tumba al supervisor — se aparta .rejected, visible, contabilizado', () => {  // verifies bloqueador QA Fix1
        const r = emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1',
            payload: { entity: 'task', title: 'sin id' },   // taskId ausente: pasa shape validation, falla la validacion profunda (Fix 6)
        });
        const out = consumePendingRequests(repo, 'rama', 'g1');
        expect(out).toEqual({ applied: 0, rejectedStale: 0, rejectedDigest: 0, rejectedInvalid: 1, corrupt: 0 });
        expect(fs.existsSync(r.file)).toBe(false);
        expect(fs.existsSync(`${r.file}.rejected`)).toBe(true);
        const s = readJournal(repo, 'rama').state!;
        expect(s.tasks).toHaveLength(0);
        expect(s.appliedRequests[r.requestId]).toBeUndefined();
        const events = fs.readFileSync(eventsPath(repo, 'rama'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        expect(events.some((e) => e.kind === 'request-rejected-invalid')).toBe(true);
        expect(() => consumePendingRequests(repo, 'rama', 'g1')).not.toThrow();
    });

    test('Fix2 (BLOQUEADOR): un veredicto PASS sobre la MISMA obligacion cierra el fix de un veredicto adverso anterior — fail->fix->pass llega a poder certificar', () => {  // verifies bloqueador QA Fix2
        emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1',
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [], reviewObligations: [{ id: 'o1', kind: 'spec' }] },
        });
        consumePendingRequests(repo, 'rama', 'g1');
        emitRequest(repo, 'rama', {
            kind: 'verdict', generationToken: 'g1', idempotencyKey: 'v1',
            payload: verdictPayload('verd-1', 'o1', 'fail', 'rompe X'),
        });
        consumePendingRequests(repo, 'rama', 'g1');
        const fpNull = () => null;
        let s = readJournal(repo, 'rama').state!;
        expect(s.fixes.find((f) => f.verdictId === 'verd-1')!.closed).toBe(false);
        let g = computeGate(s, false, fpNull);
        expect(g.reasons.some((r) => r.category === 'open-fix')).toBe(true);

        emitRequest(repo, 'rama', {
            kind: 'verdict', generationToken: 'g1', idempotencyKey: 'v2',
            payload: verdictPayload('verd-2', 'o1', 'pass', 'arreglado'),
        });
        consumePendingRequests(repo, 'rama', 'g1');
        s = readJournal(repo, 'rama').state!;
        expect(s.fixes.find((f) => f.verdictId === 'verd-1')!.closed).toBe(true);   // re-review pass cierra el fix
        g = computeGate(s, false, fpNull);
        expect(g.reasons.some((r) => r.category === 'open-fix')).toBe(false);       // ya no bloquea por open-fix
    });

    test('Fix4: register-entity cycle-plan es idempotente — un re-registro NO pisa el plan existente ni pierde satisfiedBy ya enlazado', () => {  // verifies bloqueador QA Fix4
        emitRequest(repo, 'rama', { kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1', payload: { entity: 'cycle-plan', items: [{ id: 'cv1', kind: 'qa' }] } });
        consumePendingRequests(repo, 'rama', 'g1');
        emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k1', payload: { ...jobPayload(['npm', 'run', 'qa']), satisfies: 'cv1' } });
        consumePendingRequests(repo, 'rama', 'g1');
        let s = readJournal(repo, 'rama').state!;
        const jobId = Object.keys(s.jobs)[0];
        expect(s.cycleVerificationPlan[0].satisfiedBy).toBe(jobId);

        // re-registro defensivo (ej. tras crash sin memoria de si ya se registro), incluso con items DISTINTOS
        emitRequest(repo, 'rama', { kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e2', payload: { entity: 'cycle-plan', items: [{ id: 'cv-otro', kind: 'interlock' }] } });
        consumePendingRequests(repo, 'rama', 'g1');
        s = readJournal(repo, 'rama').state!;
        expect(s.cycleVerificationPlan).toEqual([{ id: 'cv1', kind: 'qa', satisfiedBy: jobId }]);   // plan original preservado
    });

    test('Fix5: verdict --detail se redacta antes de persistir en state.json (R2.3)', () => {  // verifies bloqueador QA Fix5 / R2.3
        emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1',
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [], reviewObligations: [{ id: 'o1', kind: 'spec' }] },
        });
        consumePendingRequests(repo, 'rama', 'g1');
        emitRequest(repo, 'rama', {
            kind: 'verdict', generationToken: 'g1', idempotencyKey: 'v1',
            payload: verdictPayload('verd-1', 'o1', 'fail', 'export API_KEY=abc123secreto'),
        });
        consumePendingRequests(repo, 'rama', 'g1');
        const s = readJournal(repo, 'rama').state!;
        expect(s.verdicts[0].detail).toContain('[REDACTED]');
        expect(s.verdicts[0].detail).not.toContain('abc123secreto');
    });

    test('Fix6: register --entity task-status con taskId desconocido NO es fake-success — se rechaza, no crashea', () => {  // verifies bloqueador QA Fix6
        const r = emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1',
            payload: { entity: 'task-status', taskId: 'fantasma', status: 'done' },
        });
        const out = consumePendingRequests(repo, 'rama', 'g1');
        expect(out.rejectedInvalid).toBe(1);
        expect(out.applied).toBe(0);
        expect(fs.existsSync(`${r.file}.rejected`)).toBe(true);
    });

    test('Fix6: register --entity dispatch sin dispatchId se rechaza en vez de coercionar a la string "undefined"', () => {  // verifies bloqueador QA Fix6
        const r = emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1',
            payload: { entity: 'dispatch', taskId: 'T1' },   // dispatchId ausente
        });
        const out = consumePendingRequests(repo, 'rama', 'g1');
        expect(out.rejectedInvalid).toBe(1);
        expect(fs.existsSync(`${r.file}.rejected`)).toBe(true);
        const s = readJournal(repo, 'rama').state!;
        expect(s.dispatches).toHaveLength(0);
        expect(s.dispatches.some((d) => d.id === 'undefined')).toBe(false);
    });

    test('Fix7 (R1.4b/R3.6): verificationPlan que no cubre los requiredVerifiers del repo se rechaza EN REGISTRO, no solo en gate', () => {  // verifies bloqueador QA Fix7
        const before = readJournal(repo, 'rama').state!;
        before.requiredVerifiers = ['test'];
        writeJournal(repo, 'rama', before);
        const r = emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1',
            payload: { entity: 'task', taskId: 'T1', title: 't', verificationPlan: [], reviewObligations: [] },
        });
        const out = consumePendingRequests(repo, 'rama', 'g1');
        expect(out.rejectedInvalid).toBe(1);
        const s = readJournal(repo, 'rama').state!;
        expect(s.tasks).toHaveLength(0);   // rechazado en registro: jamas llega a existir
        expect(fs.existsSync(`${r.file}.rejected`)).toBe(true);
    });

    test('Fix8 (BLOQUEADOR, R1.5): register --entity next-action popula cycle.nextAction; un segundo registro con actionId distinto lo REEMPLAZA libremente', () => {  // verifies bloqueador QA Fix8
        emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e1',
            payload: { entity: 'next-action', actionId: 'a1', type: 'implement-task', target: 'T1', preconditions: ['x'], attempt: 1, state: 'in-progress' },
        });
        consumePendingRequests(repo, 'rama', 'g1');
        let s = readJournal(repo, 'rama').state!;
        expect(s.cycle.nextAction).toEqual({ actionId: 'a1', type: 'implement-task', target: 'T1', preconditions: ['x'], attempt: 1, state: 'in-progress' });

        emitRequest(repo, 'rama', {
            kind: 'register-entity', generationToken: 'g1', idempotencyKey: 'e2',
            payload: { entity: 'next-action', actionId: 'a2', type: 'run-qa', target: 'ciclo' },
        });
        consumePendingRequests(repo, 'rama', 'g1');
        s = readJournal(repo, 'rama').state!;
        // libremente sobre-escribible (a diferencia de cycle-plan, Fix4): es el "puntero de resumen" vigente
        expect(s.cycle.nextAction).toEqual({ actionId: 'a2', type: 'run-qa', target: 'ciclo', preconditions: [], attempt: 0, state: 'pending' });
    });
});
