// src/core/init/orchestrator.ts
import { InitDeps, InitOutcome, StepResult } from './types';
import {
    stepCache, stepHook, stepContextInjection, stepDevCore, stepGlobalSkillsRepair, stepAmbient,
    stepProfile, stepActivation, stepSensors, stepConstitution, stepConstitutionInjection, stepContext,
} from './steps';
import { runChecks } from '../diagnostics/checks';
import { gatherContext } from '../diagnostics/context';

function wrapStep(id: string, level: StepResult['level'], fn: () => StepResult | Promise<StepResult>): Promise<StepResult> {
    // id/level used only on error path; happy-path result carries its own id from the step function.
    try {
        const result = fn();
        if (result instanceof Promise) {
            return result.catch((e: unknown) => ({
                id, level, action: 'failed' as const,
                error: e instanceof Error ? e.message : String(e),
            }));
        }
        return Promise.resolve(result);
    } catch (e: unknown) {
        return Promise.resolve({
            id, level, action: 'failed' as const,
            error: e instanceof Error ? e.message : String(e),
        });
    }
}

export async function runInitSteps(deps: InitDeps): Promise<InitOutcome> {
    const before = runChecks(deps.ctx);
    const steps: StepResult[] = [];

    // Nivel máquina (siempre)
    steps.push(await wrapStep('machine.cache', 'machine', () => stepCache(deps)));
    steps.push(await wrapStep('machine.hook', 'machine', () => stepHook(deps)));
    steps.push(await wrapStep('machine.contextInjection', 'machine', () => stepContextInjection(deps)));
    steps.push(await wrapStep('machine.devCore', 'machine', () => stepDevCore(deps)));
    steps.push(await wrapStep('machine.globalSkills', 'machine', () => stepGlobalSkillsRepair(deps)));
    steps.push(await wrapStep('machine.ambient', 'machine', () => stepAmbient(deps)));

    // Nivel proyecto (solo en repo)
    if (deps.ctx.project) {
        steps.push(await wrapStep('project.profile', 'project', () => stepProfile(deps)));
        steps.push(await wrapStep('project.activation', 'project', () => stepActivation(deps)));
        steps.push(await wrapStep('project.sensors', 'project', () => stepSensors(deps)));
        steps.push(await wrapStep('project.constitution', 'project', () => stepConstitution(deps)));
        steps.push(await wrapStep('project.constitutionInjection', 'project', () => stepConstitutionInjection(deps)));
        steps.push(await wrapStep('project.context', 'project', () => stepContext(deps)));
    }

    // Re-gather fresh so the report reflects whatever the steps above just
    // installed. `results` deliberately keeps every check — including project
    // ones — so the render still shows real project state (e.g. "run awm sync")
    // when one exists; only `overall`, the exit-code verdict, needs scoping.
    //
    // If this run started with project scope nulled — `--machine-only`
    // (init.ts's effectiveCtx), or genuinely no project at this cwd — `overall`
    // must reflect only what THIS run attempted. `runChecks` otherwise mixes
    // machine + project results into one flat `overall` (checks.ts), so a
    // `--machine-only` bootstrap into an already-initialized project with
    // unrelated unsynced bundles reports "degraded" and callers gating on it
    // (`runInit`'s exit code) fail a run that fully succeeded at everything it
    // was asked to do — the exact shape of a real Codex Cloud bootstrap script
    // aborting under `set -euo pipefail` right after `awm init`.
    const after = runChecks(gatherContext({ cwd: deps.cwd, bundles: deps.bundles, agent: deps.agent }));
    if (deps.ctx.project === null) {
        after.overall = after.results
            .filter((r) => r.level === 'machine')
            .some((r) => r.status === 'missing') ? 'degraded' : 'healthy';
    }

    return {
        steps,
        applied: steps.filter((s) => s.action === 'applied').length,
        pending: steps.filter((s) => s.action === 'pending').length,
        failed: steps.filter((s) => s.action === 'failed').length,
        before,
        after,
    };
}
