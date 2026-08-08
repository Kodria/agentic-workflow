// src/core/init/steps.ts
//
// Pure, ordered, idempotent steps over the diagnostics HarnessContext.
// Each step receives InitDeps (which carries the current snapshot + injected
// actions) and returns a StepResult describing what happened.
//
// defaultActions wires the real I/O implementations; tests inject spies.

import {
    syncRegistries, registrySyncErrors, describeRegistrySyncErrors, unusableSyncedRegistries,
    type RegistrySyncResult,
} from '../registries';
import { installHook as realInstallHook } from '../../commands/hooks/install';
import { installBundle as realInstallBundle, syncProfile as realSyncProfile } from '../bundle-install';
import { initSensors as realInitSensors } from '../../commands/sensors/init';
import { addExtension as realAddExtension, ensureProfile as realEnsureProfile } from '../profile';
import { gatherContext } from '../diagnostics/context';
import { detectExtensions } from './detector';
import type { InitDeps, InitActions, StepResult } from './types';
import type { ProjectFacts } from '../diagnostics/types';
import { InjectionOrchestrator, ContextOp } from '../context/orchestrator';
import { AgentTarget, Scope, getInjection, providerFor } from '../../providers';
import { agentsSharingSkillTarget } from '../install-planner';
import { repairGlobalSkills as realRepairGlobalSkills } from '../skill-integrity';
import { contentRoots } from '../registries';
import { injectProjectConstitution as realInjectProjectConstitution } from '../context/project-constitution-inject';
import { CodexAgentsStrategy } from '../context/strategies/codex-agents';

// ---------------------------------------------------------------------------
// defaultActions — bridges the real functions to the InitActions interface
// ---------------------------------------------------------------------------

const realInjectionOrchestrator = new InjectionOrchestrator();

export const defaultActions: InitActions = {
    syncCache: async () => syncRegistries(),

    installHook: (o) => realInstallHook({
        agent: o.agent,
        registryRoot: o.registryRoot,
        installMethod: o.installMethod,
    }),

    // No `applyPlan` override here — installBundle defaults to the real
    // applyInstallPlan (install-transaction.ts, Task 6), so this materializes
    // for real on the `awm init` code path.
    installBundle: (o) => realInstallBundle({
        bundleName: o.bundleName,
        bundles: o.bundles,
        agents: o.agents,
        method: o.method,
        projectRoot: o.projectRoot,
        contentDir: o.contentDir,
    }),

    // Same as installBundle above — defaults to the real applyInstallPlan.
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

    ensureProfile: (root) => { realEnsureProfile(root); },

    gatherProject: (cwd, bundles, agent) => gatherContext({ cwd, bundles, agent }).project,

    contextStatus: (op) => realInjectionOrchestrator.contextStatus(op),

    installContext: (op) => { realInjectionOrchestrator.installContext(op); },
    repairGlobalSkills: (skillsDir, registryContentDirs) => realRepairGlobalSkills(skillsDir, registryContentDirs),
    injectProjectConstitution: (o) => {
        if (getInjection(o.agent)?.type === 'managed-agents-md') {
            return new CodexAgentsStrategy().injectProject(o.projectRoot, providerFor(o.agent), o.agent) === 'injected' ? 'injected' : 'already';
        }
        return realInjectProjectConstitution(o.projectRoot, o.agent);
    },
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

/**
 * Agents to pass as `agents` when auto-installing a global-scope bundle for
 * `d.agent`: `d.agent` itself, plus every other currently-enabled agent that
 * shares `d.agent`'s physical skill directory (today: OpenCode and Codex
 * both resolve to `~/.agents/skills`, see providers/index.ts). Baseline/
 * ambient bundles always install at 'global' scope (bundles.ts's
 * `defaultScopeForBundle` — 'baseline'/'ambient' never map to 'local'), so
 * scope is fixed here rather than threaded through InitDeps.
 *
 * Without this, a `[d.agent]` singleton would make install-planner.ts's
 * `assertCompleteSharedGroup` (R14) refuse the install outright whenever a
 * co-owner is independently enabled (e.g. `awm init --agent codex` on a
 * machine with OpenCode already enabled) — that was a BLOCKER: it broke the
 * exact "multiple providers coexist on one machine" scenario this plan
 * exists to deliver. Including the co-owner here is safe: it already has
 * this exact skill installed from its own prior init (same source, same
 * target), so `planInstall`'s dedup (R15/R15.1) collapses it into the same
 * physical operation and simply re-confirms ownership — it does not change
 * the co-owner's installed content.
 */
function sharedInstallAgents(d: InitDeps): AgentTarget[] {
    const group = agentsSharingSkillTarget(d.agent, d.enabledAgents, 'global', d.cwd);
    return group.includes(d.agent) ? group : [d.agent, ...group];
}

/**
 * Same reasoning as `sharedInstallAgents`, but for LOCAL-scope project
 * extension bundles (`stepActivation`'s `syncProfile` call). OpenCode and
 * Codex share both their global AND local skill directories
 * (`providers/index.ts`), so a project with a skill-bearing extension hits
 * the identical R14 refusal `sharedInstallAgents` was added to avoid — just
 * scoped to `proj.root` instead of the machine-global directory.
 */
function sharedActivationAgents(d: InitDeps, projectRoot: string): AgentTarget[] {
    const group = agentsSharingSkillTarget(d.agent, d.enabledAgents, 'local', projectRoot);
    return group.includes(d.agent) ? group : [d.agent, ...group];
}

/** Step 1 – Sync the registry cache (clone / pull). */
export async function stepCache(d: InitDeps): Promise<StepResult> {
    const { registryCache } = d.ctx.machine;
    const needsSync = !registryCache.present || registryCache.gitState === 'behind';
    if (!needsSync) return ok('machine.cache', 'machine', 'skipped');

    let results: RegistrySyncResult[];
    try {
        results = (await d.actions.syncCache()) ?? [];
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return failed('machine.cache', 'machine', msg);
    }

    // `syncRegistries()` reports per-registry failures as RESULTS, not throws
    // (registries.ts), so the `try` above catches none of them. Ignoring them
    // is what let an unavailable base registry degrade silently into some
    // later step's failure — with its own cause already gone.
    const errors = registrySyncErrors(results);
    if (errors.length === 0) return ok('machine.cache', 'machine', 'applied');

    // A registry that errored and has no content on disk is unusable, and every
    // later step that reads it will fail for a reason that no longer names this
    // cause — so machine.cache owns it here. One that errored but still has
    // content is stale, not broken: record it and carry on.
    const unusable = unusableSyncedRegistries(results);
    if (unusable.length > 0) {
        return failed(
            'machine.cache', 'machine',
            `registry unavailable — ${describeRegistrySyncErrors(unusable)}`,
        );
    }
    return ok('machine.cache', 'machine', 'applied', `stale registries — ${describeRegistrySyncErrors(errors)}`);
}

/** Step 2 – Install the session-start hook for the target agent. */
export function stepHook(d: InitDeps): StepResult {
    // Not every agent has a hook mechanism (today: OpenCode, Antigravity —
    // providers/index.ts's `hooks` is optional). Mirrors provider-checks.ts's
    // `hookTrustCheck`, which treats a missing `hooks` config as "not
    // applicable" rather than a failure. Without this guard, a real
    // (unstubbed) `awm init --agent opencode` throws "hooks not supported for
    // agent target: opencode" from `installHook` — a real, previously-latent
    // bug caught while building this plan's real end-to-end init test
    // (tests/integration/codex-provider-isolated.test.ts).
    if (!providerFor(d.agent).hooks) return ok('machine.hook', 'machine', 'skipped', 'no hook mechanism for this agent');

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
        agents: sharedInstallAgents(d),
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

    const skillsDir = providerFor(d.agent).skill.global;
    if (skillsDir === null) return ok('machine.globalSkills', 'machine', 'skipped');
    const r = d.actions.repairGlobalSkills(skillsDir, contentRoots());
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
            agents: sharedInstallAgents(d),
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
    if (newProposed.length === 0) return bootstrapOrSkip(d, proj, 'no new extensions');

    const confirmed = await d.confirmExtensions(newProposed, signals);
    if (confirmed.length === 0) return bootstrapOrSkip(d, proj, 'no extensions confirmed');

    for (const name of confirmed) {
        d.actions.addExtension(proj.root, name);
    }
    return ok('project.profile', 'project', 'applied', `added: ${confirmed.join(', ')}`);
}

/**
 * No new extensions to add. If the profile file doesn't exist yet, bootstrap an
 * empty one so the project is marked initialized — otherwise `awm init` would
 * leave `.awm/profile.json` missing and the diagnostic would self-referentially
 * suggest re-running `awm init`. If it already exists, this is a true no-op.
 */
function bootstrapOrSkip(d: InitDeps, proj: ProjectFacts, skipDetail: string): StepResult {
    if (!proj.profile.present) {
        d.actions.ensureProfile(proj.root);
        return ok('project.profile', 'project', 'applied', 'profile initialized (no extensions)');
    }
    return ok('project.profile', 'project', 'skipped', skipDetail);
}

/** Step 6 – Re-gather project facts and sync the profile symlinks if needed. */
export function stepActivation(d: InitDeps): StepResult {
    const proj = d.ctx.project;
    if (!proj) return ok('project.activation', 'project', 'skipped', 'no project');

    // Re-read project state so we pick up extensions added by stepProfile
    const fresh = d.actions.gatherProject(proj.root, d.bundles, d.agent) ?? proj;
    const { expected, linked, broken } = fresh.activeBundles;

    const allLinked = expected.every((e) => linked.includes(e)) && broken.length === 0;
    if (allLinked) return ok('project.activation', 'project', 'skipped');

    d.actions.syncProfile({
        projectRoot: proj.root,
        bundles: d.bundles,
        agents: sharedActivationAgents(d, proj.root),
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

    d.actions.initSensors({ cwd: proj.root, registryRoot: d.sensorPacksRoot, configure: true });
    return ok('project.sensors', 'project', 'applied');
}

/** Step 8 – Signal that the agent should run the project-constitution skill. */
export function stepConstitution(d: InitDeps): StepResult {
    const proj = d.ctx.project;
    if (!proj) return ok('project.constitution', 'project', 'skipped', 'no project');
    if (proj.constitution.present) return ok('project.constitution', 'project', 'skipped');

    return ok('project.constitution', 'project', 'pending', 'skill: project-constitution');
}

/** Step 8b – Deliver project guidance via the provider-specific context mechanism. */
export function stepConstitutionInjection(d: InitDeps): StepResult {
    const proj = d.ctx.project;
    if (!proj) return ok('project.constitutionInjection', 'project', 'skipped', 'no project');

    const inj = getInjection(d.agent);
    if (!inj || inj.type === 'cc-settings-merge') {
        return ok('project.constitutionInjection', 'project', 'skipped', 'covered by hook');
    }
    if (inj.type === 'config-instructions' && !proj.constitution.present) {
        return ok('project.constitutionInjection', 'project', 'skipped', 'no CONSTITUTION.md');
    }

    const res = d.actions.injectProjectConstitution({ projectRoot: proj.root, agent: d.agent });
    if (res === 'injected') return ok('project.constitutionInjection', 'project', 'applied');
    return ok('project.constitutionInjection', 'project', 'skipped', res);
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
    if (!inj) return ok('machine.contextInjection', 'machine', 'skipped', 'no injection mechanism');
    if (inj.type === 'cc-settings-merge') return ok('machine.contextInjection', 'machine', 'skipped', 'covered by hook');

    // Providers with no global AGENTS.md-equivalent (managed-agents-md with a null
    // globalPath — today: Copilot, and Cursor's global scope) deliver context at
    // project scope instead.
    const scope: Scope = inj.type === 'managed-agents-md' && inj.globalPath === null ? 'local' : 'global';

    // d.ctx.project?.root (computed via findProjectRoot, diagnostics/context.ts) rather
    // than raw d.cwd: mutation-targets.ts's planInitMutationTargets computes the local
    // AGENTS.md backup target via the same findProjectRoot(cwd) call, so using d.cwd here
    // whenever it differs from the walked-up project root (e.g. `awm init` run from a
    // subdirectory) would write to a path the backup session never snapshotted — a failed
    // init couldn't roll it back. Falls back to d.cwd only when there's no discovered
    // project yet, matching this op's own pre-existing behavior in that case.
    const op: ContextOp = {
        agent: d.agent,
        scope,
        registryRoot: d.registryRoot,
        installMethod: d.installMethod,
        profileExtensions: [],
        projectRoot: d.ctx.project?.root ?? d.cwd,
    };
    if (d.actions.contextStatus(op) === 'injected') return ok('machine.contextInjection', 'machine', 'skipped');

    d.actions.installContext(op);
    return ok('machine.contextInjection', 'machine', 'applied');
}
