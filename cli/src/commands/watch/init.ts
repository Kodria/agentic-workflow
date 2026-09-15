// Bootstrap unico writer (R4.1) + validacion MECANICA plan-vs-repo (R1.4b,
// bloqueador 5): la config real del repo determina los verificadores exigidos.
import fs from 'fs';
import path from 'path';
import { initBoundJournal, initJournal, readJournal, rebindJournalPlan, writeJournal } from '../../core/journal/store';
import { bindingPlanPath, statePath } from '../../core/journal/paths';
import type { PlanBinding, VerificationKind } from '../../core/journal/types';
import type { PlanValidationReport } from '../../core/plan/types';
import { acquireLock, releaseLock } from './lock';

export function detectRequiredVerifiers(repoRoot: string): VerificationKind[] {
    const kinds = new Set<VerificationKind>();
    const visit = (dir: string): void => {
        const sensors = path.join(dir, '.awm', 'sensors.json');
        if (fs.existsSync(sensors)) kinds.add('sensors');
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (entry.isSymbolicLink()) continue;
            if (entry.isFile() && entry.name === 'package.json') {
                try {
                    const pkg = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
                    if (typeof pkg === 'object' && pkg !== null && typeof pkg.scripts === 'object' && pkg.scripts !== null && typeof pkg.scripts.test === 'string') kinds.add('test');
                } catch { /* package ilegible: no prueba disponibilidad */ }
            }
            if (entry.isDirectory() && !['node_modules', '.git', '.awm'].includes(entry.name)) visit(path.join(dir, entry.name));
        }
    };
    visit(repoRoot);
    return (['test', 'sensors'] as VerificationKind[]).filter((kind) => kinds.has(kind));
}

/** El journal es gitignoreado (R1.1): sus escrituras jamas alteran fingerprints. */
export function ensureJournalGitignored(repoRoot: string): void {
    const gi = path.join(repoRoot, '.gitignore');
    let current = '';
    try { current = fs.readFileSync(gi, 'utf8'); } catch { current = ''; }
    if (!current.split('\n').some((l) => l.trim() === '.awm/' || l.trim() === '.awm')) {
        fs.writeFileSync(gi, current.length > 0 && !current.endsWith('\n') ? `${current}\n.awm/\n` : `${current}.awm/\n`);
    }
}

export type WatchPlanInit = { path: string; report: PlanValidationReport };

const TERMINAL_JOB_STATES = new Set(['exited', 'cancelled']);

function rebindBlocker(state: ReturnType<typeof readJournal>['state']): string | undefined {
    if (state === null) return 'journal inexistente o corrupto';
    const nonterminal = Object.values(state.jobs).filter(job => !TERMINAL_JOB_STATES.has(job.executionState));
    if (nonterminal.length > 0) return `hay jobs no terminales: ${nonterminal.map(job => job.id).join(', ')}`;
    if (state.requestProblems.length > 0) return 'hay conflictos durables de requests';
    if (state.verdicts.some(verdict => verdict.result !== 'pass')) return 'hay evidencia adversa durable';
    if (state.fixes.some(fix => !fix.closed)) return 'hay fixes abiertos';
    if (state.cycle.status === 'BLOCKED') return 'el ciclo está bloqueado';
    if (state.tracks?.some(track => track.phase !== 'REMOVED')) return 'hay tracks no terminales';
    return undefined;
}

export function initWatch(repoRoot: string, branch: string, plan?: WatchPlanInit): { requiredVerifiers: VerificationKind[]; planBinding?: PlanBinding } {
    if (plan && plan.report.state !== 'valid') throw new Error('watch --init --plan requiere un plan compacto válido');
    if (plan && fs.existsSync(statePath(repoRoot, branch))) {
        throw new Error('refusing to overwrite existing journal');
    }
    ensureJournalGitignored(repoRoot);
    let planBinding: PlanBinding | undefined;
    if (plan) {
        const report = plan.report as Extract<PlanValidationReport, { state: 'valid' }>;
        planBinding = {
            path: bindingPlanPath(plan.path), digest: report.planDigest, schema: report.schema,
            executionMode: 'desatendido', boundAt: new Date().toISOString(),
        };
    }
    if (planBinding) initBoundJournal(repoRoot, branch, planBinding);
    else initJournal(repoRoot, branch);
    const required = detectRequiredVerifiers(repoRoot);
    const r = readJournal(repoRoot, branch);
    if (r.corrupt || r.state === null) throw new Error('journal corrupto tras init: no se continua (R1.6)');
    const s = r.state;
    if (JSON.stringify(s.requiredVerifiers) !== JSON.stringify(required)) {
        s.requiredVerifiers = required;
        writeJournal(repoRoot, branch, s);
    }
    return { requiredVerifiers: required, ...(planBinding ? { planBinding } : {}) };
}

/**
 * Intentional recovery route for a valid compact plan whose lifecycle update
 * changed its digest.  It cannot initialize or overwrite a journal: only an
 * existing schema-2 unattended binding for the exact canonical plan path is
 * eligible, and all outstanding work/evidence conflicts fail closed.
 */
export function rebindWatchPlan(repoRoot: string, branch: string, plan: WatchPlanInit): PlanBinding {
    if (plan.report.state !== 'valid') throw new Error('watch rebind --plan requiere un plan compacto válido');
    // The same exclusive lock used by the supervisor closes the interval
    // between observing quiescence and publishing the recovered binding.
    const lock = acquireLock(repoRoot);
    try {
        const current = readJournal(repoRoot, branch);
        if (current.corrupt || current.state === null || current.state.schema !== 2 || !current.state.planBinding) {
            throw new Error('no existe un journal schema-2 desatendido para reconciliar');
        }
        const existing = current.state.planBinding;
        const canonicalPath = bindingPlanPath(plan.path);
        if (existing.executionMode !== 'desatendido') throw new Error('solo se reconcilia un binding desatendido');
        if (existing.path !== canonicalPath) throw new Error('rebind requiere la misma ruta canónica del plan');
        if (existing.digest === plan.report.planDigest && existing.schema === plan.report.schema) throw new Error('el binding ya está vigente');
        const blocker = rebindBlocker(current.state);
        if (blocker) throw new Error(`rebind rechazado: ${blocker}`);
        const report = plan.report;
        const binding: PlanBinding = {
            path: canonicalPath, digest: report.planDigest, schema: report.schema,
            executionMode: 'desatendido', boundAt: new Date().toISOString(),
        };
        rebindJournalPlan(repoRoot, branch, binding);
        return binding;
    } finally {
        releaseLock(repoRoot, lock);
    }
}
