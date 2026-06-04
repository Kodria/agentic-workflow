// src/core/init/orchestrator.ts
import { InitDeps, InitOutcome, StepResult } from './types';
import {
    stepCache, stepHook, stepDevCore, stepAmbient,
    stepProfile, stepActivation, stepSensors, stepConstitution, stepContext,
} from './steps';
import { runChecks } from '../diagnostics/checks';
import { gatherContext } from '../diagnostics/context';

export async function runInitSteps(deps: InitDeps): Promise<InitOutcome> {
    const before = runChecks(deps.ctx);
    const steps: StepResult[] = [];

    // Nivel máquina (siempre)
    steps.push(await stepCache(deps));
    steps.push(stepHook(deps));
    steps.push(stepDevCore(deps));
    steps.push(stepAmbient(deps));

    // Nivel proyecto (solo en repo)
    if (deps.ctx.project) {
        steps.push(await stepProfile(deps));
        steps.push(stepActivation(deps));
        steps.push(stepSensors(deps));
        steps.push(stepConstitution(deps));
        steps.push(stepContext(deps));
    }

    const after = runChecks(gatherContext({ cwd: deps.cwd, bundles: deps.bundles }));

    return {
        steps,
        applied: steps.filter((s) => s.action === 'applied').length,
        pending: steps.filter((s) => s.action === 'pending').length,
        failed: steps.filter((s) => s.action === 'failed').length,
        before,
        after,
    };
}
