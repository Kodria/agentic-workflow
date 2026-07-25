// src/commands/update.ts
//
// `awm update` — syncs configured registries, regenerates global context,
// reconciles machine-scope artifacts (baseline/ambient bundles) against the
// freshly synced content, and re-syncs the SessionStart hook's managed files
// — all scoped to the resolved agent targets (R12/R13). Every stage after
// the registry sync is a real gate: a failure in context regeneration,
// artifact reconciliation, or hook resync reports the failing provider and
// returns a non-zero exit code (no silent `catch {}` swallowing failures).
// NOTE: deliberately no top-level `@clack/prompts` import here — this module
// is `require()`d directly by tests exercising `runUpdateCore`, and
// `@clack/prompts` ships ESM-only, which the CommonJS ts-jest transform can't
// load. The intro/outro chrome lives in `index.ts`'s Commander registration
// instead (which already imports clack at the top and is never `require()`d
// by tests).
import pc from 'picocolors';
import { AgentTarget } from '../providers';
import { getPreferences } from '../utils/config';
import { resolveAgentTargets } from '../core/agent-targets';
import {
    syncRegistries, verifyMinCliVersions, assertRegistryGates, contentRoots, capabilityRoot,
    RegistrySyncResult,
} from '../core/registries';
import { regenerateGlobalContext, RegenResult } from '../core/context/regenerate';
import { planReconciliation } from '../core/reconciliation';
import { applyInstallPlan as realApplyInstallPlan, InstallSummary } from '../core/install-transaction';
import { InstallPlan } from '../core/install-planner';
import { resyncInstalledHooks, ResyncResult } from '../commands/hooks/resync';
// `core/update-check.ts` imports `@clack/prompts` (ESM-only) at its top level
// for its interactive confirm() prompt — required lazily below, inside the
// default dep, so `require()`-ing this module for `runUpdateCore` alone never
// pulls it in.

export type RunUpdateOptions = {
    agent?: string;
};

export type RunUpdateDeps = {
    syncRegistries: () => Promise<RegistrySyncResult[]>;
    verifyMinCliVersions: () => ReturnType<typeof verifyMinCliVersions>;
    regenerateGlobalContext: (targets: AgentTarget[]) => RegenResult[];
    planReconciliation: (params: { targets: AgentTarget[]; roots: string[] }) => InstallPlan;
    applyInstallPlan: (plan: InstallPlan) => InstallSummary;
    resyncInstalledHooks: (registryRoot: string, targets: AgentTarget[]) => ResyncResult[];
    offerSelfUpdate: () => Promise<void>;
};

const defaultDeps: RunUpdateDeps = {
    syncRegistries,
    verifyMinCliVersions,
    regenerateGlobalContext,
    planReconciliation,
    applyInstallPlan: realApplyInstallPlan,
    resyncInstalledHooks,
    offerSelfUpdate: async () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { offerSelfUpdate: real } = require('../core/update-check');
        await real();
    },
};

export type RunUpdateResult = {
    code: number;
    selectedAgents: AgentTarget[];
};

/**
 * Core, UI-free `awm update` logic: resolves agent targets, runs every stage
 * in order (registry sync → CLI-version gate → context regen → artifact
 * reconciliation → hook resync → self-update offer), and returns the
 * selected targets alongside an exit code so callers/tests don't need to
 * scrape console output. `deps` is fully injectable for tests (mirrors
 * `runInit`'s `actions` seam).
 */
export async function runUpdateCore(
    options: RunUpdateOptions = {},
    deps: Partial<RunUpdateDeps> = {},
): Promise<RunUpdateResult> {
    const d: RunUpdateDeps = { ...defaultDeps, ...deps };
    const prefs = getPreferences();

    let selectedAgents: AgentTarget[];
    try {
        selectedAgents = resolveAgentTargets({ prefs, explicit: options.agent });
    } catch (e) {
        console.error(pc.red((e as Error).message));
        return { code: 1, selectedAgents: [] };
    }

    const registryResults = await d.syncRegistries();
    for (const r of registryResults) {
        if (r.action === 'error') console.warn(pc.yellow(`  ⚠  registry ${r.name}: ${r.error}`));
        else console.log(pc.green(`  ✓ Registry ${r.name} ${r.action === 'pulled' ? 'updated' : 're-cloned'} @ ${r.version}`));
    }

    try {
        assertRegistryGates(d.verifyMinCliVersions());
    } catch (e) {
        console.error(pc.red((e as Error).message));
        return { code: 1, selectedAgents };
    }

    const regen = d.regenerateGlobalContext(selectedAgents);
    const refreshed = regen.filter((r) => r.action === 'refreshed').map((r) => r.agent);
    if (refreshed.length > 0) console.log(pc.green(`  ✓ Regenerated AWM context for: ${refreshed.join(', ')}`));

    let artifactResult: InstallSummary;
    try {
        const artifactPlan = d.planReconciliation({ targets: selectedAgents, roots: contentRoots() });
        artifactResult = d.applyInstallPlan(artifactPlan);
    } catch (e) {
        console.error(pc.red(`Artifact reconciliation failed: ${(e as Error).message}`));
        return { code: 1, selectedAgents };
    }
    if (artifactResult.installed.length > 0) {
        console.log(pc.green(`  ✓ Reconciled artifacts: ${artifactResult.installed.join(', ')}`));
    }

    const hooksRoot = capabilityRoot('hooks');
    if (hooksRoot) {
        try {
            for (const r of d.resyncInstalledHooks(hooksRoot, selectedAgents)) {
                if (r.action === 'resynced') console.log(pc.green(`  ✓ Re-synced ${r.agent} hook scripts`));
                else if (r.action === 'registry-missing') console.warn(pc.yellow(`  ⚠  ${r.agent} hook installed but registry hooks missing — run 'awm hooks install'`));
            }
        } catch (e) {
            console.error(pc.red(`Hook resync failed: ${(e as Error).message}`));
            return { code: 1, selectedAgents };
        }
    }

    await d.offerSelfUpdate();

    return { code: 0, selectedAgents };
}
