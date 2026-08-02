// Interlock mecanico (design R3.2): falla CERRADO. Solo `pass` con fingerprint
// VIGENTE satisface (R1.4c, RF-2.8). Cada agujero del bloqueador 5 de la
// review tiene su categoria propia — nada aprueba por vacuidad ni por
// referencia falsa.
import type { JournalState, VerificationItem, VerificationKind } from '../../core/journal/types';

export type GateCategory =
    | 'corrupt' | 'cycle-blocked' | 'live-job' | 'pending-task'
    | 'empty-cycle-plan' | 'missing-verifier' | 'dangling-reference'
    | 'unsatisfied-plan' | 'adverse-verdict' | 'stale-fingerprint'
    | 'open-obligation' | 'open-fix' | 'request-problem';
export interface GateReason { category: GateCategory; detail: string; }
export interface GateResult { pass: boolean; reasons: GateReason[]; }

/** Recomputo de vigencia inyectado: el CLI/supervisor pasan computeFingerprint
 *  real; null = no demostrable => NO certifica. */
export type FingerprintNow = (argv: string[], paths: string[], cwd: string) => string | null;

const LIVE = ['received', 'spawn-intent', 'claimed', 'running', 'cancel-requested'];

export function computeGate(state: JournalState | null, corrupt: boolean, fingerprintNow: FingerprintNow): GateResult {
    const reasons: GateReason[] = [];
    if (corrupt || state === null) {
        return { pass: false, reasons: [{ category: 'corrupt', detail: 'state.json corrupto o ilegible: la corrupcion jamas certifica' }] };
    }
    if (state.cycle.status === 'BLOCKED') {
        reasons.push({ category: 'cycle-blocked', detail: `ciclo BLOCKED: ${state.cycle.blockedReason ?? 'sin razon registrada'}` });
    }
    for (const problem of state.requestProblems) {
        reasons.push({ category: 'request-problem', detail: `request ${problem.kind} en ${problem.file}: ${problem.detail}` });
    }
    for (const j of Object.values(state.jobs)) {
        if (LIVE.includes(j.executionState) || j.executionState === 'orphaned') {
            reasons.push({ category: 'live-job', detail: `job ${j.id} en ${j.executionState}` });
        }
    }
    for (const t of state.tasks) {
        if (t.status !== 'done') {
            reasons.push({ category: 'pending-task', detail: `task ${t.id} en ${t.status}` });
        }
    }
    if (state.cycleVerificationPlan.length === 0) {
        reasons.push({ category: 'empty-cycle-plan', detail: 'CycleVerificationPlan vacio: un ciclo sin plan de cierre jamas certifica (R1.4b)' });
    }
    for (const required of ['qa', 'interlock'] as const) {
        if (!state.cycleVerificationPlan.some((item) => item.kind === required)) {
            reasons.push({ category: 'missing-verifier', detail: `CycleVerificationPlan requiere '${required}'` });
        }
    }
    // Verificadores requeridos por la config REAL del repo (watch --init):
    // cada kind requerido debe existir en algun plan (R1.4b, R3.6).
    const allPlans: VerificationItem[] = [...state.tasks.flatMap((t) => t.verificationPlan), ...state.cycleVerificationPlan];
    const presentKinds = new Set<VerificationKind>(allPlans.map((i) => i.kind));
    for (const mechanical of ['test', 'sensors'] as const) {
        if (!state.requiredVerifiers.includes(mechanical)) {
            reasons.push({ category: 'missing-verifier', detail: `el repo no tiene '${mechanical}' configurado; no se certifica por ausencia (R3.6)` });
        }
    }
    for (const required of state.requiredVerifiers) {
        if (!presentKinds.has(required)) {
            reasons.push({ category: 'missing-verifier', detail: `el repo exige verificador '${required}' y ningun plan lo contiene` });
        }
    }
    for (const item of allPlans) {
        if (item.satisfiedBy === undefined) {
            reasons.push({ category: 'unsatisfied-plan', detail: `item ${item.id} (${item.kind}) sin satisfacer` });
            continue;
        }
        if (item.kind === 'review') {
            const v = state.verdicts.find((x) => x.id === item.satisfiedBy);
            if (v === undefined) {
                reasons.push({ category: 'dangling-reference', detail: `item ${item.id} cita verdict inexistente ${item.satisfiedBy}` });
            } else if (v.result !== 'pass') {
                reasons.push({ category: 'adverse-verdict', detail: `item ${item.id} citado por verdict ${v.id} con result ${v.result}` });
            } else {
                const now = fingerprintNow(v.argv, v.paths, v.cwd);
                if (now === null || now !== v.fingerprint) {
                    reasons.push({ category: 'stale-fingerprint', detail: `verdict ${v.id} es historico y no certifica` });
                }
            }
            continue;
        }
        const j = state.jobs[item.satisfiedBy];
        if (j === undefined) {
            reasons.push({ category: 'dangling-reference', detail: `item ${item.id} cita job inexistente ${item.satisfiedBy}` });
            continue;
        }
        if (j.verdict !== 'pass') {
            reasons.push({ category: 'adverse-verdict', detail: `item ${item.id} citado por ${item.satisfiedBy} con verdict ${j.verdict ?? 'ausente'}` });
            continue;
        }
        // Vigencia (RF-2.8): recomputar con argv/paths/cwd del job y comparar.
        const now = fingerprintNow(j.argv, j.paths, j.cwd);
        if (now === null || now !== j.fingerprint) {
            reasons.push({ category: 'stale-fingerprint', detail: `item ${item.id}: la evidencia de ${j.id} es historica (fingerprint ${now === null ? 'no recomputable' : 'cambiado'}) — no certifica` });
        }
    }
    for (const t of state.tasks) {
        for (const requiredKind of ['spec', 'quality'] as const) {
            if (!t.reviewObligations.some((o) => o.kind === requiredKind)) {
                reasons.push({ category: 'open-obligation', detail: `task ${t.id} carece de ReviewObligation ${requiredKind}` });
            }
        }
        for (const o of t.reviewObligations) {
            if (o.verdictId === undefined) {
                reasons.push({ category: 'open-obligation', detail: `obligacion ${o.id} sin verdict` });
                continue;
            }
            const v = state.verdicts.find((x) => x.id === o.verdictId);
            if (v === undefined) {
                reasons.push({ category: 'dangling-reference', detail: `obligacion ${o.id} cita verdict inexistente ${o.verdictId}` });
            } else if (v.result !== 'pass') {
                reasons.push({ category: 'adverse-verdict', detail: `obligacion ${o.id} citada por verdict ${v.id} con result ${v.result}` });
            } else {
                const now = fingerprintNow(v.argv, v.paths, v.cwd);
                if (now === null || now !== v.fingerprint) {
                    reasons.push({ category: 'stale-fingerprint', detail: `verdict ${v.id} de obligacion ${o.id} es historico y no certifica` });
                }
            }
        }
    }
    for (const v of state.verdicts) {
        if (v.result !== 'pass') {
            const fix = state.fixes.find((f) => f.verdictId === v.id);
            if (fix === undefined || !fix.closed) reasons.push({ category: 'open-fix', detail: `verdict adverso ${v.id} sin fix cerrado` });
        }
    }
    return { pass: reasons.length === 0, reasons };
}
