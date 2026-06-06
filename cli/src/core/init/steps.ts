// src/core/init/steps.ts
//
// Pure, ordered, idempotent steps over the diagnostics HarnessContext.
// Each step receives InitDeps (which carries the current snapshot + injected
// actions) and returns a StepResult describing what happened.
//
// defaultActions wires the real I/O implementations; tests inject spies.

import { syncRegistry } from '../registry';
import { installHook as realInstallHook } from '../../commands/hooks/install';
import { installBundle as realInstallBundle, syncProfile as realSyncProfile } from '../bundle-install';
import { initSensors as realInitSensors } from '../../commands/sensors/init';
import { addExtension as realAddExtension } from '../profile';
import { gatherContext } from '../diagnostics/context';
import { detectExtensions } from './detector';
import type { InitDeps, InitActions, StepResult } from './types';
import { InjectionOrchestrator, ContextOp } from '../context/orchestrator';
import { getInjection, PROVIDERS } from '../../providers';
import { repairGlobalSkills as realRepairGlobalSkills } from '../skill-integrity';
import { REGISTRY_CONTENT_DIR } from '../bundles';

// ---------------------------------------------------------------------------
// defaultActions — bridges the real functions to the InitActions interface
// ---------------------------------------------------------------------------

const realInjectionOrchestrator = new InjectionOrchestrator();

export const defaultActions: InitActions = {
    syncCache: async () => { await syncRegistry(); },

    installHook: (o) => realInstallHook({
        agent: o.agent,
        registryRoot: o.registryRoot,
        installMethod: o.installMethod,
    }),

    installBundle: (o) => realInstallBundle({
        bundleName: o.bundleName,
        bundles: o.bundles,
        agents: o.agents,
        method: o.method,
        projectRoot: o.projectRoot,
        contentDir: o.contentDir,
    }),

    syncProfile: (o) => realSyncProfile({
        projectRoot: o.projectRoot,
        bundles: o.bundles,
        agents: o.agents,
        method: o.method,
        contentDir: o.contentDir,
    }),

    initSensors: (o) => {
        const result = realInitSensors({ cwd: o.cwd, registryRoot: o.registryRoot, configure: o.configure });
        return { detection: result.detection };
    },

    addExtension: (root, name) => { realAddExtension(root, name); },

    gatherProject: (cwd, bundles) => gatherContext({ cwd, bundles }).project,

    contextStatus: (op) => realInjectionOrchestrator.contextStatus(op),

    installContext: (op) => { realInjectionOrchestrator.installContext(op); },
    repairGlobalSkills: (skillsDir, registryContentDir) => realRepairGlobalSkills(skillsDir, registryContentDir),
};

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

function ok(id: string, level: StepResult['level'], action: StepResult['action'], detail?: string): StepResult {
    return { id, level, action, detail };
}

function failed(id: string, level: StepResult['level'], error: string): StepResult {
    return { id, level, action: 'failed', error };
}

// ---------------------------------------------------------------------------
// Machine-level steps
// ---------------------------------------------------------------------------

/** Step 1 – Sync the registry cache (clone / pull). */
export async function stepCache(d: InitDeps): Promise<StepResult> {
    const { cliSource } = d.ctx.machine;
    const needsSync = !cliSource.present || cliSource.gitState === 'behind';
    if (!needsSync) return ok('machine.cache', 'machine', 'skipped');

    try {
        await d.actions.syncCache();
        return ok('machine.cache', 'machine', 'applied');
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return failed('machine.cache', 'machine', msg);
    }
}

/** Step 2 – Install the session-start hook for the target agent. */
export function stepHook(d: InitDeps): StepResult {
    const { hook } = d.ctx.machine;
    if (hook.present && !hook.degraded) return ok('machine.hook', 'machine', 'skipped');

    d.actions.installHook({
        agent: d.agent,
        registryRoot: d.registryRoot,
        installMethod: d.installMethod,
    });
    return ok('machine.hook', 'machine', 'applied');
}

/** Step 3 – Install / repair the baseline bundle (dev-core). */
export function stepDevCore(d: InitDeps): StepResult {
    const { devCore } = d.ctx.machine;
    if (devCore.present && devCore.brokenLinks.length === 0) {
        return ok('machine.devCore', 'machine', 'skipped');
    }

    // Find the baseline bundle (there may be several; pick first baseline)
    const baselineBundle = d.bundles.find((b) => b.scope === 'baseline');
    const bundleName = baselineBundle?.name ?? 'dev';

    d.actions.installBundle({
        bundleName,
        bundles: d.bundles,
        agents: [d.agent],
        method: d.installMethod,
        projectRoot: d.cwd,
        contentDir: d.contentDir,
    });
    return ok('machine.devCore', 'machine', 'applied');
}

/** Step 3.5 – Repair broken global skill symlinks (orphans outside the baseline). */
export function stepGlobalSkillsRepair(d: InitDeps): StepResult {
    const { globalSkills } = d.ctx.machine;
    const broken = globalSkills.repairable.length + globalSkills.dead.length;
    if (broken === 0) return ok('machine.globalSkills', 'machine', 'skipped');

    const skillsDir = PROVIDERS[d.agent].skill.global;
    const r = d.actions.repairGlobalSkills(skillsDir, REGISTRY_CONTENT_DIR);
    return ok('machine.globalSkills', 'machine', 'applied', `re-linked ${r.relinked.length}, pruned ${r.pruned.length}`);
}

/** Step 4 – Install missing ambient bundles. */
export function stepAmbient(d: InitDeps): StepResult {
    const { wanted, installed } = d.ctx.machine.ambient;
    if (wanted.length === 0) return ok('machine.ambient', 'machine', 'skipped');

    const missing = wanted.filter((w) => !installed.includes(w));
    if (missing.length === 0) return ok('machine.ambient', 'machine', 'skipped');

    for (const bundleName of missing) {
        d.actions.installBundle({
            bundleName,
            bundles: d.bundles,
            agents: [d.agent],
            method: d.installMethod,
            projectRoot: d.cwd,
            contentDir: d.contentDir,
        });
    }
    return ok('machine.ambient', 'machine', 'applied', `installed: ${missing.join(', ')}`);
}

// ---------------------------------------------------------------------------
// Project-level steps
// ---------------------------------------------------------------------------

/** Step 5 – Detect and confirm project extensions, then add them to the profile. */
export async function stepProfile(d: InitDeps): Promise<StepResult> {
    const proj = d.ctx.project;
    if (!proj) return ok('project.profile', 'project', 'skipped', 'no project');

    const { proposed, signals } = detectExtensions(proj.root);
    const alreadyPresent = proj.profile.extensions;
    const newProposed = proposed.filter((p) => !alreadyPresent.includes(p));
    if (newProposed.length === 0) return ok('project.profile', 'project', 'skipped', 'sin extensiones nuevas');

    const confirmed = await d.confirmExtensions(newProposed, signals);
    if (confirmed.length === 0) return ok('project.profile', 'project', 'skipped');

    for (const name of confirmed) {
        d.actions.addExtension(proj.root, name);
    }
    return ok('project.profile', 'project', 'applied', `added: ${confirmed.join(', ')}`);
}

/** Step 6 – Re-gather project facts and sync the profile symlinks if needed. */
export function stepActivation(d: InitDeps): StepResult {
    const proj = d.ctx.project;
    if (!proj) return ok('project.activation', 'project', 'skipped', 'no project');

    // Re-read project state so we pick up extensions added by stepProfile
    const fresh = d.actions.gatherProject(proj.root, d.bundles) ?? proj;
    const { expected, linked, broken } = fresh.activeBundles;

    const allLinked = expected.every((e) => linked.includes(e)) && broken.length === 0;
    if (allLinked) return ok('project.activation', 'project', 'skipped');

    d.actions.syncProfile({
        projectRoot: proj.root,
        bundles: d.bundles,
        agents: [d.agent],
        method: d.installMethod,
        contentDir: d.contentDir,
    });
    return ok('project.activation', 'project', 'applied');
}

/** Step 7 – Initialize the sensor manifest if absent. */
export function stepSensors(d: InitDeps): StepResult {
    const proj = d.ctx.project;
    if (!proj) return ok('project.sensors', 'project', 'skipped', 'no project');
    if (proj.sensors.present) return ok('project.sensors', 'project', 'skipped');

    d.actions.initSensors({ cwd: proj.root, registryRoot: d.contentDir, configure: true });
    return ok('project.sensors', 'project', 'applied');
}

/** Step 8 – Signal that the agent should run the project-constitution skill. */
export function stepConstitution(d: InitDeps): StepResult {
    const proj = d.ctx.project;
    if (!proj) return ok('project.constitution', 'project', 'skipped', 'no project');
    if (proj.constitution.present) return ok('project.constitution', 'project', 'skipped');

    return ok('project.constitution', 'project', 'pending', 'skill: project-constitution');
}

/** Step 9 – Signal that the agent should run the project-context-init skill. */
export function stepContext(d: InitDeps): StepResult {
    const proj = d.ctx.project;
    if (!proj) return ok('project.context', 'project', 'skipped', 'no project');
    if (proj.context.present) return ok('project.context', 'project', 'skipped');

    return ok('project.context', 'project', 'pending', 'skill: project-context-init');
}

/** Step 2b – Inject AWM context for agents whose mechanism isn't the Claude hook. */
export function stepContextInjection(d: InitDeps): StepResult {
    const inj = getInjection(d.agent);
    if (!inj) return ok('machine.contextInjection', 'machine', 'skipped', 'sin mecanismo de inyección');
    if (inj.type === 'cc-settings-merge') return ok('machine.contextInjection', 'machine', 'skipped', 'cubierto por hook');

    const op: ContextOp = {
        agent: d.agent,
        scope: 'global',
        registryRoot: d.registryRoot,
        installMethod: d.installMethod,
        profileExtensions: [],
    };
    if (d.actions.contextStatus(op) === 'injected') return ok('machine.contextInjection', 'machine', 'skipped');

    d.actions.installContext(op);
    return ok('machine.contextInjection', 'machine', 'applied');
}
