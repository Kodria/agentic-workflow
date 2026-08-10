import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { Command } from 'commander';
import { computeGate, computeTrackGate, FingerprintNow } from '../../../src/commands/job/gate';
import { reconcileJobs, materializeRetry } from '../../../src/commands/job/reconcile';
import { planReap, executeReap } from '../../../src/commands/job/reap';
import { registerJobCommand } from '../../../src/commands/job';
import { registerWatchCommand } from '../../../src/commands/watch';
import { emptyState, Job, JournalState, TrackRef } from '../../../src/core/journal/types';
import { initJournal, readJournal, writeJournal } from '../../../src/core/journal/store';
import { writeDescriptor, TrackDescriptor } from '../../../src/core/tracks/descriptor';

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

    test('computeGate produce el mismo conjunto de categorias que antes de la extraccion de evaluateEvidence (regresion R1)', () => {
        const s = passingState();
        s.cycle.status = 'BLOCKED';
        s.cycle.blockedReason = 'custodia';
        s.cycleVerificationPlan = [];
        s.tasks[0].status = 'pending';
        s.tasks[0].reviewObligations = [];
        s.jobs['live'] = job({ id: 'live', executionState: 'running' });
        const g = computeGate(s, false, fpCurrent);
        const categories = [...new Set(g.reasons.map((r) => r.category))].sort();
        expect(categories).toEqual(
            ['cycle-blocked', 'empty-cycle-plan', 'live-job', 'missing-verifier', 'open-obligation', 'pending-task'].sort(),
        );
    });
});

/** Task 12 (R7/C4) — brecha de scope cerrada: el file-list del plan
 *  requeria tocar `gate.ts` para el nuevo `VerificationKind` 'track-integration',
 *  pero `evaluateEvidence` (arriba, linea ~78-111) ya es generico sobre TODO
 *  kind salvo 'review' — cae al mismo lookup `state.jobs[item.satisfiedBy]` +
 *  chequeo de verdict/vigencia de fingerprint sin importar el kind. Como
 *  `apply.ts` (`linkSatisfies`, llamado una vez por id en el bucle de
 *  job-request) enlaza VARIOS items `track-integration:*` al MISMO jobId
 *  cuando un solo job canonico de integracion satisface a toda la cohorte
 *  (C4 — un unico job, nunca uno por track), el bucle generico por-item ya
 *  evalua ese escenario correctamente: cada item hace su propio lookup
 *  independiente del MISMO job, así que ambos certifican juntos cuando pasa
 *  con fingerprint vigente, y ambos caen a 'stale-fingerprint' juntos cuando
 *  ese UNICO job deja de estar vigente. Esta suite documenta esa conclusion
 *  con evidencia real — CERO cambios de logica en gate.ts eran necesarios. */
describe('track-integration: un unico job satisface a MULTIPLES items de cohorte (R7/C4, Task 12 — scope gap)', () => {
    function stateWithSharedIntegrationJob(): JournalState {
        const s = emptyState('r');
        s.requiredVerifiers = ['test', 'sensors'];
        s.cycleVerificationPlan = [
            { id: 'qa', kind: 'qa', satisfiedBy: 'job-qa' },
            { id: 'interlock', kind: 'interlock', satisfiedBy: 'job-interlock' },
            { id: 'test', kind: 'test', satisfiedBy: 'job-test' },
            { id: 'sensors', kind: 'sensors', satisfiedBy: 'job-sensors' },
            // Dos tracks ('a', 'b'), UN solo job canonico de integracion
            // (`job-integration`) satisface a AMBOS items — exactamente lo
            // que `runRequestFinalIntegration` (watch/tracks.ts) produce vía
            // `requestJob({ satisfies: ids, ... })` con `ids` = el conjunto
            // COMPLETO y ordenado de `track-integration:*` de la cohorte.
            { id: 'track-integration:a', kind: 'track-integration', satisfiedBy: 'job-integration' },
            { id: 'track-integration:b', kind: 'track-integration', satisfiedBy: 'job-integration' },
        ];
        for (const id of ['job-qa', 'job-interlock', 'job-test', 'job-sensors', 'job-integration']) {
            s.jobs[id] = job({ id, fingerprint: 'fp', executionState: 'exited', verdict: 'pass' });
        }
        return s;
    }

    test('un job pasando con fingerprint vigente certifica AMBOS items de track-integration a la vez, sin cambios en gate.ts', () => {
        const s = stateWithSharedIntegrationJob();
        const g = computeGate(s, false, fpCurrent);
        expect(g.pass).toBe(true);
        expect(g.reasons).toEqual([]);
    });

    test('cuando ESE UNICO job pierde vigencia, AMBOS items de track-integration caen a stale-fingerprint juntos (nunca uno sin el otro)', () => {
        const s = stateWithSharedIntegrationJob();
        const g = computeGate(s, false, fpStale);
        expect(g.pass).toBe(false);
        const staleTrackIntegration = g.reasons.filter(
            (r) => r.category === 'stale-fingerprint' && /track-integration:/.test(r.detail),
        );
        expect(staleTrackIntegration).toHaveLength(2);
        expect(staleTrackIntegration.some((r) => /track-integration:a/.test(r.detail))).toBe(true);
        expect(staleTrackIntegration.some((r) => /track-integration:b/.test(r.detail))).toBe(true);
    });

    test('si el job compartido falla (verdict no-pass), AMBOS items de track-integration bloquean por adverse-verdict', () => {
        const s = stateWithSharedIntegrationJob();
        s.jobs['job-integration'].verdict = 'fail';
        const g = computeGate(s, false, fpCurrent);
        expect(g.pass).toBe(false);
        const adverse = g.reasons.filter((r) => r.category === 'adverse-verdict' && /track-integration:/.test(r.detail));
        expect(adverse).toHaveLength(2);
    });
});

/** Estado de journal de un TRACK individual (C6, R3.5): trackContext con la
 *  tarea asignada ya `done`, cycleVerificationPlan VACIO (un track no exige
 *  QA/interlock de ambito de plan), y evidencia local completa (item de
 *  test/sensors satisfecho, obligaciones spec/quality con verdict pass) —
 *  todo con el MISMO fingerprint que el gate va a recomputar ('same'). */
function stateWithCompletedTrackTask(): JournalState {
    const s = emptyState('track/cli');
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
    s.jobs['j1'] = job({ id: 'j1', fingerprint: 'same', executionState: 'exited', verdict: 'pass' });
    s.jobs['j2'] = job({ id: 'j2', fingerprint: 'same', executionState: 'exited', verdict: 'pass' });
    s.verdicts.push(
        { id: 'verd-spec', obligationId: 'o-spec', result: 'pass', detail: 'ok', receivedAt: 'now', fingerprint: 'same', argv: ['review', 'o-spec'], paths: [], cwd: '.' },
        { id: 'verd-quality', obligationId: 'o-quality', result: 'pass', detail: 'ok', receivedAt: 'now', fingerprint: 'same', argv: ['review', 'o-quality'], paths: [], cwd: '.' },
    );
    return s;
}

describe('computeTrackGate — gate local de un track (C6, R3.5)', () => {
    test('computeTrackGate no exige qa/interlock global (R3.5, C6)', () => {
        const s = stateWithCompletedTrackTask();
        expect(computeTrackGate(s, false, () => 'same')).toEqual({ pass: true, reasons: [] });
        expect(computeGate(s, false, () => 'same').pass).toBe(false);
    });

    // El journal de un track REAL tiene `requiredVerifiers: []`: `initTrackJournal` llama a
    // `initJournal`, no a `initWatch`, así que la detección mecánica de verificadores nunca
    // corre sobre el worktree del track. La fixture de arriba los pobla a mano y por eso
    // tapaba el defecto — R3.6 ("el repo no tiene test/sensors configurado") vivía FUERA del
    // guard `requireGlobalKinds`, así que el gate local de todo track quedaba rojo para
    // siempre, `attemptFreeze` devolvía `continue` en cada tick, y sin freeze no hay merge
    // (C3) ni `COMPLETE`. Observado en la certificación con supervisor vivo.
    test('un journal de track SIN requiredVerifiers (el caso real) certifica igual: R3.6 es del gate global', () => {
        const s = stateWithCompletedTrackTask();
        s.requiredVerifiers = [];
        const g = computeTrackGate(s, false, () => 'same');
        expect(g.reasons.filter((r) => /no se certifica por ausencia/.test(r.detail))).toEqual([]);
        expect(g).toEqual({ pass: true, reasons: [] });
        // El gate GLOBAL sí sigue exigiéndolo: la regla no se debilitó, se puso en su scope.
        const global = computeGate({ ...s, requiredVerifiers: [] }, false, () => 'same');
        expect(global.reasons.some((r) => /no se certifica por ausencia/.test(r.detail))).toBe(true);
    });

    test('corrupcion o journal ausente bloquea con categoria propia (corrupt-state)', () => {
        const g = computeTrackGate(null, true, () => 'same');
        expect(g.pass).toBe(false);
        expect(g.reasons).toEqual([{ category: 'corrupt-state', detail: expect.any(String) }]);
    });

    test('journal sin trackContext no es un journal de track: bloquea con wrong-context', () => {
        const s = stateWithCompletedTrackTask();
        delete s.trackContext;
        const g = computeTrackGate(s, false, () => 'same');
        expect(g.pass).toBe(false);
        expect(g.reasons).toEqual([{ category: 'wrong-context', detail: expect.any(String) }]);
    });

    test('una tarea ajena colada en el journal del track se rechaza, jamas certifica por ella (R2.3)', () => {
        const s = stateWithCompletedTrackTask();
        s.tasks.push({ id: 'ajena', title: 'x', status: 'done', attempts: 1, verificationPlan: [], reviewObligations: [] });
        const g = computeTrackGate(s, false, () => 'same');
        expect(g.pass).toBe(false);
        expect(g.reasons).toEqual([{ category: 'foreign-task', detail: expect.stringContaining('ajena') }]);
    });

    test('sigue exigiendo verificadores mecanicos y fingerprint vigente localmente (no es un gate vacio)', () => {
        const s = stateWithCompletedTrackTask();
        s.jobs['j1'].fingerprint = 'cambiado';
        expect(computeTrackGate(s, false, () => 'same').reasons.some((r) => r.category === 'stale-fingerprint')).toBe(true);
        const s2 = stateWithCompletedTrackTask();
        s2.requiredVerifiers = ['test', 'sensors', 'lint'];
        expect(computeTrackGate(s2, false, () => 'same').reasons.some((r) => r.category === 'missing-verifier' && /lint/.test(r.detail))).toBe(true);
    });
});

describe('reconcile — matriz unica R1.8 (R3.3)', () => {
    let logs: string;
    beforeEach(() => { logs = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-rec-')); });
    afterEach(() => { fs.rmSync(logs, { recursive: true, force: true }); });

    test('sin claim => reintenta mismo intent; claim+resultado => adoptar; claim sin resultado => orphaned', () => {  // verifies R3.3
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
        expect(out.decisions.find((d) => d.jobId === 'a')!.action).toBe('retry-same-intent');
        expect(out.decisions.find((d) => d.jobId === 'b')!.action).toBe('adopt-result');
        expect(s.jobs['b'].executionState).toBe('exited');
        expect(s.jobs['b'].verdict).toBe('pass');
        expect(out.decisions.find((d) => d.jobId === 'c')!.action).toBe('orphaned-authorization-required');
        expect(s.jobs['c'].executionState).toBe('orphaned');
    });

    test('materializeRetry crea Attempt NUEVO enlazado, nunca reutiliza (R1.7)', () => {  // verifies R1.7
        const s = emptyState('r');
        s.jobs['a'] = job({ id: 'a', executionState: 'spawn-intent', spawnNonce: 'nA' });
        s.tasks.push({ id: 'T1', title: 't', status: 'in-progress', attempts: 1,
            verificationPlan: [{ id: 'v1', kind: 'test', satisfiedBy: 'a' }], reviewObligations: [] });
        s.cycleVerificationPlan.push({ id: 'cv1', kind: 'qa', satisfiedBy: 'a' });
        const nuevo = materializeRetry(s, 'a');
        expect(s.jobs['a'].executionState).toBe('cancelled');       // el intento viejo se retira
        expect(nuevo.attemptOf).toBe('a');
        expect(nuevo.executionState).toBe('received');
        expect(nuevo.spawnNonce).toBeUndefined();                   // nonce fresco lo asigna el runner
        expect(s.jobs[nuevo.id]).toBe(nuevo);
        expect(s.tasks[0].verificationPlan[0].satisfiedBy).toBe(nuevo.id);
        expect(s.cycleVerificationPlan[0].satisfiedBy).toBe(nuevo.id);
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
        // deadRef.pid (999999) debe comportarse como un pid REALMENTE
        // ausente ante un sondeo de existencia (signal 0) — igual que en
        // windows-latest real, donde `isWindowsNative()` es cierto de
        // verdad y refIsAlive/groupIsGone dependen de pidExistsNative
        // (process.kill(pid, 0)) como UNICA fuente de veredicto (ronda 3,
        // ver process.ts). Mockear esto como "siempre exito" incondicional
        // rompia esa unica fuente de verdad en CI real: pidExistsNative
        // reportaba "vivo" para un pid que nunca existio, y la escalera de
        // terminacion quedaba reintentando hasta el timeout del test — no
        // por una señal real enviada, sino porque nunca podia CONFIRMAR
        // ausencia. En POSIX este spy ni siquiera se ejercita (refIsAlive
        // ahi usa ps/pgrep, no process.kill), asi que el fix solo cambia
        // comportamiento win32.
        const killSpy = jest.spyOn(process, 'kill').mockImplementation((pid: number) => {
            if (pid === deadRef.pid) { const err: any = new Error('no such process'); err.code = 'ESRCH'; throw err; }
            return true;
        });
        try {
            const killed = await executeReap(s, ['sinRef', 'muerto', 'no-existe']);
            expect(killed).toEqual([]);
            // no solo el resultado: nunca se envio una señal REAL de
            // terminacion (R2.1) — la ausencia de identidad viva confirmada
            // corta antes de llegar a terminateGroupConfirmed. pidExistsNative
            // SI llama a process.kill(pid, 0) como sondeo de existencia
            // (signal 0, no una señal real) — eso aparece legitimamente en
            // este spy y no es evidencia de una señal enviada; se filtra
            // explicitamente (mismo patron ya aplicado en adapter.test.ts
            // para execFileSync, narrowing en vez de "cero llamadas").
            const realSignals = killSpy.mock.calls.filter((call) => call[1] !== 0);
            expect(realSignals).toEqual([]);
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

// El guard de contexto (R9.4) se prueba a nivel de comando REGISTRADO: `job
// gate` y `watch --init` deben rechazar un cwd cuyo descriptor no autentica,
// y deben proceder EXACTAMENTE igual que antes cuando no hay descriptor
// (caso comun) o cuando el descriptor si autentica.
class ExitSignal extends Error { constructor(public code: number) { super(`process.exit(${code})`); } }

function gitInitAt(repo: string, branch: string): void {
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'init', '-q', '-b', branch], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'f.txt'), 'x');
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'add', '.'], { cwd: repo });
    execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'c'], { cwd: repo });
}

function trackRefFixture(overrides: Partial<TrackRef>, worktreePath: string): TrackRef {
    return {
        trackId: 'cli', worktreePath, branch: 'track/cli', ownership: [], sharedResources: [], dependsOn: [],
        fencingToken: 'f'.repeat(32), phase: 'ACTIVE', readinessNonce: 'n'.repeat(8), ...overrides,
    };
}

function descriptorFixture(overrides: Partial<TrackDescriptor>, planRoot: string): TrackDescriptor {
    return { schema: 1, planRoot, planBranch: 'main', trackId: 'cli', planJournalId: 'j-1', fencingToken: 'f'.repeat(32), ...overrides };
}

async function runCommand(register: (prog: Command) => void, argv: string[], cwd: string): Promise<{ out: string; err: string; exitCode: number | null }> {
    const prog = new Command();
    prog.exitOverride();
    register(prog);
    const outSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const errSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(cwd);
    let exitCode: number | null = null;
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        exitCode = code ?? 0;
        throw new ExitSignal(exitCode);
    }) as never);
    try {
        await prog.parseAsync(['node', 'awm', ...argv]);
    } catch (e) {
        if (!(e instanceof ExitSignal)) throw e;
    } finally {
        cwdSpy.mockRestore();
        exitSpy.mockRestore();
    }
    const out = outSpy.mock.calls.map((c) => String(c[0])).join('');
    const err = errSpy.mock.calls.map((c) => String(c[0])).join('');
    outSpy.mockRestore();
    errSpy.mockRestore();
    return { out, err, exitCode };
}

const runJob = (argv: string[], cwd: string) => runCommand(registerJobCommand, ['job', ...argv], cwd);
const runWatch = (argv: string[], cwd: string) => runCommand(registerWatchCommand, ['watch', ...argv], cwd);

describe('guard de contexto en awm job / awm watch (R9.4)', () => {
    let planRoot: string;
    let trackRoot: string;
    let otherRoot: string;

    beforeEach(() => {
        planRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-guard-plan-'));
        trackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-guard-track-'));
        otherRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-guard-other-'));
        gitInitAt(planRoot, 'main');
        gitInitAt(trackRoot, 'track/cli');
        gitInitAt(otherRoot, 'track/cli');

        initJournal(planRoot, 'main');
        const planState = readJournal(planRoot, 'main').state!;
        planState.journalId = 'j-1';
        planState.tracks = [trackRefFixture({ fencingToken: 'f'.repeat(32) }, trackRoot)];
        writeJournal(planRoot, 'main', planState);

        initJournal(trackRoot, 'track/cli');
        const trackState = readJournal(trackRoot, 'track/cli').state!;
        trackState.trackContext = { trackId: 'cli', taskIds: [], planDigest: 'x', baseSha: 'y', planJournalId: 'j-1' };
        writeJournal(trackRoot, 'track/cli', trackState);
        writeDescriptor(trackRoot, descriptorFixture({ planJournalId: 'j-1', fencingToken: 'f'.repeat(32) }, planRoot));

        // otherRoot: mismo descriptor (mismo plan/trackId/fencing) pero NO es
        // el worktree que el TrackRef del plan declara — su realpath jamas
        // puede autenticar (R9.4), aunque el resto del descriptor "calce".
        initJournal(otherRoot, 'track/cli');
        const otherState = readJournal(otherRoot, 'track/cli').state!;
        otherState.trackContext = { trackId: 'cli', taskIds: [], planDigest: 'x', baseSha: 'y', planJournalId: 'j-1' };
        writeJournal(otherRoot, 'track/cli', otherState);
        writeDescriptor(otherRoot, descriptorFixture({ planJournalId: 'j-1', fencingToken: 'f'.repeat(32) }, planRoot));
    });

    afterEach(() => {
        for (const dir of [planRoot, trackRoot, otherRoot]) fs.rmSync(dir, { recursive: true, force: true });
    });

    test('`job gate` desde un cwd cuyo descriptor no autentica (realpath no coincide con el TrackRef) rechaza con "cwd no autenticado"', async () => {
        const { err, exitCode } = await runJob(['gate'], otherRoot);
        expect(exitCode).toBe(1);
        expect(err).toContain('cwd no autenticado');
    });

    test('`job gate` desde el cwd autenticado (trackRoot) atraviesa el guard sin bloquear por autenticacion', async () => {
        const { out, err, exitCode } = await runJob(['gate'], trackRoot);
        // el guard NO bloqueo (nunca imprime "cwd no autenticado"); computeGate
        // (todavia global, sin distinguir modo track — eso es de otra task)
        // bloquea por otras razones, lo cual es esperado y no es objeto de este test.
        expect(err).not.toContain('cwd no autenticado');
        expect(exitCode).toBe(1);
        expect(JSON.parse(out).pass).toBe(false);
    });

    test('`watch --init` desde un cwd SIN descriptor (repo comun, sin tracks) procede exactamente como antes de esta task', async () => {
        const plainRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-guard-plain-'));
        try {
            gitInitAt(plainRepo, 'main');
            const { out, err, exitCode } = await runWatch(['--init'], plainRepo);
            expect(exitCode).toBeNull();
            expect(err).toBe('');
            expect(out).toContain('journal inicializado');
        } finally {
            fs.rmSync(plainRepo, { recursive: true, force: true });
        }
    });

    test('`watch --init` desde el cwd autenticado (trackRoot) procede con normalidad', async () => {
        const { out, err, exitCode } = await runWatch(['--init'], trackRoot);
        expect(err).not.toContain('cwd no autenticado');
        expect(exitCode).toBeNull();
        expect(out).toContain('journal inicializado');
    });

    test('`watch --init` desde un cwd cuyo descriptor no autentica rechaza con "cwd no autenticado"', async () => {
        const { err, exitCode } = await runWatch(['--init'], otherRoot);
        expect(exitCode).toBe(1);
        expect(err).toContain('cwd no autenticado');
    });
});
