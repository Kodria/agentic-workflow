import fs from 'fs';
import path from 'path';
import os from 'os';
import { consumePendingRequests } from '../../../src/commands/watch/apply';
import { emitRequest } from '../../../src/core/journal/requests';
import { initJournal, readJournal } from '../../../src/core/journal/store';
import { requestsDir, eventsPath } from '../../../src/core/journal/paths';
import * as atomicFile from '../../../src/core/atomic-file';

function jobPayload(argv: string[]): Record<string, unknown> {
    return { argv, paths: [], cwd: '.', fingerprint: 'fp-1', commandDigest: 'cd-1', expandedPaths: [] };
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
            payload: { verdictId: 'verd-1', obligationId: 'o1', result: 'fail', detail: 'rompe X' },
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
    });

    test('kind no reconocido (sintacticamente valido) se trata como corrupt, jamas se descarta en silencio (R1.6)', () => {  // verifies R1.6
        const r = emitRequest(repo, 'rama', { kind: 'job-request', generationToken: 'g1', idempotencyKey: 'k1', payload: jobPayload(['npm', 'test']) });
        // simula un kind forward-incompatible/corrupto pero JSON sintacticamente valido
        const raw = JSON.parse(fs.readFileSync(r.file, 'utf8'));
        raw.kind = 'kind-desconocido-xyz';
        fs.writeFileSync(r.file, JSON.stringify(raw, null, 2) + '\n');

        const out = consumePendingRequests(repo, 'rama', 'g1');
        expect(out).toEqual({ applied: 0, rejectedStale: 0, corrupt: 1 });   // NUNCA "applied: 1" silencioso
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
});
