import fs from 'fs';
import path from 'path';
import os from 'os';
import { computeGate, FingerprintNow } from '../../../src/commands/job/gate';
import { reconcileJobs, materializeRetry } from '../../../src/commands/job/reconcile';
import { planReap, executeReap } from '../../../src/commands/job/reap';
import { emptyState, Job, JournalState } from '../../../src/core/journal/types';

function job(partial: Partial<Job>): Job {
    return {
        id: 'j1', fingerprint: 'fp', commandDigest: 'cd', argv: ['npm', 'test'], cwd: '.',
        paths: [], expandedPaths: [], executionState: 'received', observationState: 'progressing',
        phaseTimestamps: {}, ...partial,
    };
}

const fpCurrent: FingerprintNow = () => 'fp';        // recomputo == persistido => vigente
const fpStale: FingerprintNow = () => 'fp-cambiado'; // el arbol cambio => historica

/** Estado que SATISFACE el gate: task done, plan de task y de ciclo con pass
 *  vigente, verificador requerido cubierto, cero vivos, cero obligaciones. */
function passingState(): JournalState {
    const s = emptyState('r');
    s.requiredVerifiers = ['test', 'sensors'];
    s.cycleVerificationPlan = [
        { id: 'cv1', kind: 'qa', satisfiedBy: 'j2' },
        { id: 'cv2', kind: 'interlock', satisfiedBy: 'j3' },
    ];
    s.tasks.push({
        id: 'T1', title: 't', status: 'done', attempts: 1,
        verificationPlan: [
            { id: 'v1', kind: 'test', satisfiedBy: 'j1' },
            { id: 'v-sensors', kind: 'sensors', satisfiedBy: 'j4' },
        ],
        reviewObligations: [
            { id: 'o-spec', taskId: 'T1', kind: 'spec', verdictId: 'verd-spec' },
            { id: 'o-quality', taskId: 'T1', kind: 'quality', verdictId: 'verd-quality' },
        ],
    });
    s.jobs['j1'] = job({ id: 'j1', executionState: 'exited', verdict: 'pass' });
    s.jobs['j2'] = job({ id: 'j2', executionState: 'exited', verdict: 'pass' });
    s.jobs['j3'] = job({ id: 'j3', executionState: 'exited', verdict: 'pass' });
    s.jobs['j4'] = job({ id: 'j4', executionState: 'exited', verdict: 'pass' });
    s.verdicts.push(
        { id: 'verd-spec', obligationId: 'o-spec', result: 'pass', detail: 'ok', receivedAt: 'now', fingerprint: 'fp', argv: ['review', 'o-spec'], paths: [], cwd: '.' } as never,
        { id: 'verd-quality', obligationId: 'o-quality', result: 'pass', detail: 'ok', receivedAt: 'now', fingerprint: 'fp', argv: ['review', 'o-quality'], paths: [], cwd: '.' } as never,
    );
    return s;
}

describe('gate', () => {
    test('el estado de referencia pasa; la corrupcion bloquea (R3.2)', () => {  // verifies R3.2
        expect(computeGate(passingState(), false, fpCurrent).pass).toBe(true);
        const g = computeGate(null, true, fpCurrent);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'corrupt')).toBe(true);
    });

    test('CycleVerificationPlan VACIO bloquea — jamas verde por vacuidad (R1.4b)', () => {  // verifies R1.4b
        const s = passingState();
        s.cycleVerificationPlan = [];
        const g = computeGate(s, false, fpCurrent);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'empty-cycle-plan')).toBe(true);
    });

    test('CycleVerificationPlan exige QA e interlock, no solo cualquier item aprobado (R1.4b/R3.2)', () => {
        const s = passingState();
        s.cycleVerificationPlan = s.cycleVerificationPlan.filter((item) => item.kind !== 'interlock');
        const g = computeGate(s, false, fpCurrent);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'missing-verifier' && /interlock/.test(r.detail))).toBe(true);
    });

    test('cada tarea exige obligaciones spec y quality, no certifica por omision', () => {
        const s = passingState();
        s.tasks[0].reviewObligations = [];
        const g = computeGate(s, false, fpCurrent);
        expect(g.pass).toBe(false);
        expect(g.reasons.filter((r) => r.category === 'open-obligation')).toHaveLength(2);
    });

    test('review pass con fingerprint historico no certifica', () => {
        const s = passingState();
        const fingerprintByArgv: FingerprintNow = (argv) => argv[0] === 'review' ? 'fp-cambiado' : 'fp';
        const g = computeGate(s, false, fingerprintByArgv);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'stale-fingerprint' && /verd-spec/.test(r.detail))).toBe(true);
    });

    test('ausencia de suite o sensors configurados bloquea aunque el plan restante este verde (R3.6)', () => {
        const s = passingState();
        s.requiredVerifiers = ['test'];
        const g = computeGate(s, false, fpCurrent);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'missing-verifier' && /sensors/.test(r.detail))).toBe(true);
    });

    test('satisfiedBy colgante (job inexistente) bloquea (R3.2)', () => {   // verifies R3.2
        const s = passingState();
        s.tasks[0].verificationPlan[0].satisfiedBy = 'job-fantasma';
        const g = computeGate(s, false, fpCurrent);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'dangling-reference')).toBe(true);
    });

    test('tarea pending o in-progress bloquea (R3.2)', () => {              // verifies R3.2
        const s = passingState();
        s.tasks.push({ id: 'T2', title: 'x', status: 'pending', attempts: 0, verificationPlan: [], reviewObligations: [] });
        expect(computeGate(s, false, fpCurrent).reasons.some((r) => r.category === 'pending-task')).toBe(true);
        s.tasks[1].status = 'in-progress';
        expect(computeGate(s, false, fpCurrent).reasons.some((r) => r.category === 'pending-task')).toBe(true);
    });

    test('ciclo BLOCKED bloquea el gate (R3.2)', () => {                     // verifies R3.2
        const s = passingState();
        s.cycle.status = 'BLOCKED';
        s.cycle.blockedReason = 'custodia';
        expect(computeGate(s, false, fpCurrent).reasons.some((r) => r.category === 'cycle-blocked')).toBe(true);
    });

    test('fingerprint NO vigente => evidencia historica, bloquea (R1.4c, RF-2.8)', () => {  // verifies R1.4c
        const g = computeGate(passingState(), false, fpStale);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'stale-fingerprint')).toBe(true);
        // recomputo imposible (null) tampoco certifica
        const g2 = computeGate(passingState(), false, () => null);
        expect(g2.reasons.some((r) => r.category === 'stale-fingerprint')).toBe(true);
    });

    test('solo pass satisface: fail/inconclusive bloquean; sin verdict bloquea (R1.4c)', () => {  // verifies R1.4c
        const s = passingState();
        s.jobs['j1'].verdict = 'fail';
        expect(computeGate(s, false, fpCurrent).reasons.some((r) => r.category === 'adverse-verdict')).toBe(true);
        s.jobs['j1'].verdict = 'inconclusive';
        expect(computeGate(s, false, fpCurrent).reasons.some((r) => r.category === 'adverse-verdict')).toBe(true);
        delete s.jobs['j1'].verdict;
        expect(computeGate(s, false, fpCurrent).reasons.some((r) => r.category === 'adverse-verdict')).toBe(true);
    });

    test('item kind review se satisface con VERDICT pass, no con job (R1.4c)', () => {  // verifies R1.4c
        const s = passingState();
        s.tasks[0].verificationPlan.push({ id: 'v2', kind: 'review', satisfiedBy: 'verd-1' });
        s.verdicts.push({ id: 'verd-1', obligationId: 'o1', result: 'pass', detail: 'ok', receivedAt: 'now', fingerprint: 'fp', argv: ['review', 'o1'], paths: [], cwd: '.' } as never);
        expect(computeGate(s, false, fpCurrent).pass).toBe(true);
        s.verdicts[0].result = 'fail';
        const g = computeGate(s, false, fpCurrent);
        expect(g.reasons.some((r) => r.category === 'adverse-verdict')).toBe(true);
        expect(g.reasons.some((r) => r.category === 'open-fix')).toBe(true);  // adverso sin fix cerrado
    });

    test('item sin satisfacer, job vivo, orphaned y obligacion abierta bloquean (R3.2, R4.5)', () => {  // verifies R4.5
        const s = passingState();
        s.tasks[0].verificationPlan.push({ id: 'v3', kind: 'sensors' });
        expect(computeGate(s, false, fpCurrent).reasons.some((r) => r.category === 'unsatisfied-plan')).toBe(true);
        const s2 = passingState();
        s2.jobs['vivo'] = job({ id: 'vivo', executionState: 'running' });
        expect(computeGate(s2, false, fpCurrent).reasons.some((r) => r.category === 'live-job')).toBe(true);
        s2.jobs['vivo'].executionState = 'orphaned';
        expect(computeGate(s2, false, fpCurrent).reasons.some((r) => r.category === 'live-job')).toBe(true);
        const s3 = passingState();
        s3.tasks[0].reviewObligations.push({ id: 'o9', taskId: 'T1', kind: 'spec' });
        expect(computeGate(s3, false, fpCurrent).reasons.some((r) => r.category === 'open-obligation')).toBe(true);
    });

    test('verificador requerido por el repo sin item en ningun plan bloquea (R1.4b, R3.6)', () => {  // verifies R3.6
        const s = passingState();
        s.tasks[0].verificationPlan = s.tasks[0].verificationPlan.filter((item) => item.kind !== 'sensors');
        const g = computeGate(s, false, fpCurrent);  // ningun item kind 'sensors' existe
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'missing-verifier' && /sensors/.test(r.detail))).toBe(true);
    });

    test('reviewObligation con verdictId colgante o adverso bloquea, no solo si esta ausente (R3.2, R1.4c)', () => {  // verifies R3.2
        const s = passingState();
        s.tasks[0].reviewObligations.push({ id: 'o1', taskId: 'T1', kind: 'spec', verdictId: 'verd-fantasma' });
        const g = computeGate(s, false, fpCurrent);
        expect(g.pass).toBe(false);
        expect(g.reasons.some((r) => r.category === 'dangling-reference')).toBe(true);
        const s2 = passingState();
        s2.verdicts.push({ id: 'verd-2', obligationId: 'o2', result: 'fail', detail: 'no', receivedAt: 'now', fingerprint: 'fp', argv: ['review', 'o2'], paths: [], cwd: '.' });
        s2.tasks[0].reviewObligations.push({ id: 'o2', taskId: 'T1', kind: 'spec', verdictId: 'verd-2' });
        const g2 = computeGate(s2, false, fpCurrent);
        expect(g2.pass).toBe(false);
        expect(g2.reasons.some((r) => r.category === 'adverse-verdict')).toBe(true);
    });
});

describe('reconcile — matriz unica R1.8 (R3.3)', () => {
    let logs: string;
    beforeEach(() => { logs = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rec-')); });
    afterEach(() => { fs.rmSync(logs, { recursive: true, force: true }); });

    test('sin claim => retry; claim+resultado => adoptar; claim sin resultado => orphaned', () => {  // verifies R3.3
        const s = emptyState('r');
        const deadRef = { pid: 999999, startTime: 'gone', spawnNonce: 'n1', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        s.jobs['a'] = job({ id: 'a', executionState: 'spawn-intent', spawnNonce: 'nA', processRef: { ...deadRef, spawnNonce: 'nA' } });
        s.jobs['b'] = job({ id: 'b', executionState: 'running', spawnNonce: 'nB', processRef: { ...deadRef, spawnNonce: 'nB' } });
        s.jobs['c'] = job({ id: 'c', executionState: 'running', spawnNonce: 'nC', processRef: { ...deadRef, spawnNonce: 'nC' } });
        // b: claim + resultado => adoptar
        fs.writeFileSync(path.join(logs, 'b.nB.claim'), '{}');
        fs.writeFileSync(path.join(logs, 'b.nB.result.json'), JSON.stringify({ exitCode: 0, endedAt: 'x', resultPath: 'p' }));
        // c: claim sin resultado => orphaned
        fs.writeFileSync(path.join(logs, 'c.nC.claim'), '{}');
        const out = reconcileJobs(s, logs);
        expect(out.decisions.find((d) => d.jobId === 'a')!.action).toBe('retry-new-attempt');
        expect(out.decisions.find((d) => d.jobId === 'b')!.action).toBe('adopt-result');
        expect(s.jobs['b'].executionState).toBe('exited');
        expect(s.jobs['b'].verdict).toBe('pass');
        expect(out.decisions.find((d) => d.jobId === 'c')!.action).toBe('orphaned-authorization-required');
        expect(s.jobs['c'].executionState).toBe('orphaned');
    });

    test('materializeRetry crea Attempt NUEVO enlazado, nunca reutiliza (R1.7)', () => {  // verifies R1.7
        const s = emptyState('r');
        s.jobs['a'] = job({ id: 'a', executionState: 'spawn-intent', spawnNonce: 'nA' });
        const nuevo = materializeRetry(s, 'a');
        expect(s.jobs['a'].executionState).toBe('cancelled');       // el intento viejo se retira
        expect(nuevo.attemptOf).toBe('a');
        expect(nuevo.executionState).toBe('received');
        expect(nuevo.spawnNonce).toBeUndefined();                   // nonce fresco lo asigna el runner
        expect(s.jobs[nuevo.id]).toBe(nuevo);
    });

    test('claim+resultado con forma invalida (JSON valido pero sin exitCode numerico) => orphaned, jamas fabricar verdict (R1.6)', () => {  // verifies R1.6
        const s = emptyState('r');
        const deadRef = { pid: 999999, startTime: 'gone', spawnNonce: 'nD', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        s.jobs['d'] = job({ id: 'd', executionState: 'running', spawnNonce: 'nD', processRef: { ...deadRef, spawnNonce: 'nD' } });
        fs.writeFileSync(path.join(logs, 'd.nD.claim'), '{}');
        fs.writeFileSync(path.join(logs, 'd.nD.result.json'), JSON.stringify({}));  // sin exitCode: forma invalida
        const out = reconcileJobs(s, logs);
        expect(out.decisions.find((d) => d.jobId === 'd')!.action).toBe('orphaned-authorization-required');
        expect(s.jobs['d'].executionState).toBe('orphaned');
        expect(s.jobs['d'].verdict).toBeUndefined();   // jamas fabricado de un sidecar sin forma
    });

    test('claim+resultado con JSON invalido (parse error) => orphaned, no crashea (R1.6)', () => {  // verifies R1.6
        const s = emptyState('r');
        const deadRef = { pid: 999999, startTime: 'gone', spawnNonce: 'nE', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        s.jobs['e'] = job({ id: 'e', executionState: 'running', spawnNonce: 'nE', processRef: { ...deadRef, spawnNonce: 'nE' } });
        fs.writeFileSync(path.join(logs, 'e.nE.claim'), '{}');
        fs.writeFileSync(path.join(logs, 'e.nE.result.json'), '{ esto no es json valido');
        let out: ReturnType<typeof reconcileJobs>;
        expect(() => { out = reconcileJobs(s, logs); }).not.toThrow();
        expect(out!.decisions.find((d) => d.jobId === 'e')!.action).toBe('orphaned-authorization-required');
        expect(s.jobs['e'].executionState).toBe('orphaned');
    });

    test('adopt-result respalda spawnNonce resuelto via processRef, para que la evidencia siga siendo observable (R1.3, RNF-T.9)', () => {  // verifies R1.3
        const s = emptyState('r');
        const deadRef = { pid: 999999, startTime: 'gone', spawnNonce: 'nR', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        s.jobs['r1'] = job({ id: 'r1', executionState: 'running', processRef: deadRef });  // spawnNonce propio ausente adrede
        fs.writeFileSync(path.join(logs, 'r1.nR.claim'), '{}');
        fs.writeFileSync(path.join(logs, 'r1.nR.result.json'), JSON.stringify({ exitCode: 0, endedAt: 'x', resultPath: 'p' }));
        reconcileJobs(s, logs);
        expect(s.jobs['r1'].spawnNonce).toBe('nR');
        expect(s.jobs['r1'].executionState).toBe('exited');
    });
});

describe('reap — limpieza explicita con identidad validada (R2.2)', () => {
    test('planReap reporta aliveWithIdentity via refIsAlive, solo para jobs con processRef', () => {
        const s = emptyState('r');
        const deadRef = { pid: 999999, startTime: 'gone', spawnNonce: 'n1', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        s.jobs['sinRef'] = job({ id: 'sinRef', executionState: 'running' });
        s.jobs['muerto'] = job({ id: 'muerto', executionState: 'running', processRef: deadRef });
        const plan = planReap(s);
        expect(plan.find((p) => p.jobId === 'sinRef')).toBeUndefined();
        const m = plan.find((p) => p.jobId === 'muerto')!;
        expect(m.pid).toBe(999999);
        expect(m.aliveWithIdentity).toBe(false);
    });

    test('planReap reporta aliveWithIdentity: true para un proceso genuinamente vivo', () => {
        const { spawnStructured } = require('../../../src/core/journal/process');
        const s = emptyState('r');
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 5000)'], process.cwd(), 'nLive');
        s.jobs['vivo'] = job({ id: 'vivo', executionState: 'running', processRef: ref });
        try {
            const plan = planReap(s);
            const m = plan.find((p) => p.jobId === 'vivo')!;
            expect(m.pid).toBe(ref.pid);
            expect(m.aliveWithIdentity).toBe(true);
        } finally {
            child.kill('SIGKILL');
        }
    });

    test('executeReap nunca señaliza sin processRef ni sin identidad viva confirmada (R2.1, R2.2)', async () => {
        const s = emptyState('r');
        const deadRef = { pid: 999999, startTime: 'gone', spawnNonce: 'n1', argvDigest: 'd', processGroup: 999999, psArgsDigest: 'x' };
        s.jobs['sinRef'] = job({ id: 'sinRef', executionState: 'running' });
        s.jobs['muerto'] = job({ id: 'muerto', executionState: 'running', processRef: deadRef });
        const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);
        try {
            const killed = await executeReap(s, ['sinRef', 'muerto', 'no-existe']);
            expect(killed).toEqual([]);
            // no solo el resultado: nunca se INTENTO ninguna señal (R2.1) —
            // la ausencia de identidad viva confirmada corta antes de llamar
            // a terminateGroupConfirmed/process.kill, no despues.
            expect(killSpy).not.toHaveBeenCalled();
        } finally {
            killSpy.mockRestore();
        }
    });

    test('executeReap mata y reporta solo jobs con muerte confirmada', async () => {
        const { spawnStructured } = require('../../../src/core/journal/process');
        const s = emptyState('r');
        const { child, ref } = spawnStructured(['node', '-e', 'setTimeout(()=>{}, 5000)'], process.cwd(), 'nX');
        s.jobs['vivo'] = job({ id: 'vivo', executionState: 'running', processRef: ref });
        const killed = await executeReap(s, ['vivo']);
        expect(killed).toEqual(['vivo']);
        child.kill('SIGKILL');
    });
});
