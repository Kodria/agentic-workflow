// src/core/reconciliation.ts
//
// `awm update`'s artifact reconciliation: for every enabled agent's target,
// makes what's on disk match what SHOULD be installed by the currently
// synced registries (machine-scope bundles — baseline/dev-core + ambient).
// Replaces the previous ad-hoc `reconcileAllSkillLinks` relinking with a real
// InstallPlan (install-planner.ts), so `update` goes through the same
// transactional apply (install-transaction.ts's applyInstallPlan) as `init`
// and `add` — backups before any replace, rollback on verification failure.
//
// Deliberately narrow: reconciliation targets the artifacts `awm init`
// itself would install machine-wide (baseline + ambient bundles), NOT
// project-local extensions (those are `awm sync`'s job) and not pruning of
// orphaned/dead links (that remains `stepGlobalSkillsRepair`'s job, run at
// `awm init` time). Widening this is left to a follow-up if `update` needs to
// also prune.
import { AgentTarget } from '../providers';
import { BundleDefinition, discoverAllBundles } from './bundles';
import { ArtifactIntent, InstallPlan, planInstall } from './install-planner';
import { expandBundleArtifacts } from './bundle-install';
import { getPreferences } from '../utils/config';

export type PlanReconciliationParams = {
    targets: AgentTarget[];
    roots: string[];
    /** Overridable for tests; defaults to discovering bundles from `roots`. */
    bundles?: BundleDefinition[];
    /** Overridable for tests; defaults to the persisted preferences' enabledAgents. */
    enabledAgents?: AgentTarget[];
};

function intentKey(intent: ArtifactIntent): string {
    return `${intent.type}\0${intent.installName}\0${intent.sourcePath}`;
}

/**
 * Computes the InstallPlan that reconciles every machine-scope (baseline +
 * ambient) artifact for `targets` against the currently synced registries at
 * `roots`. Pure — no filesystem writes; callers apply the result with
 * `applyInstallPlan` (install-transaction.ts).
 */
export function planReconciliation(params: PlanReconciliationParams): InstallPlan {
    const { targets, roots } = params;
    const bundles = params.bundles ?? discoverAllBundles(roots);
    const contentDir = roots[0] ?? '';
    const machineBundles = bundles.filter((b) => b.scope === 'baseline' || b.scope === 'ambient');

    const seen = new Set<string>();
    const artifacts: ArtifactIntent[] = [];
    for (const b of machineBundles) {
        let intents: ArtifactIntent[];
        try {
            intents = expandBundleArtifacts({
                bundleName: b.name,
                bundles,
                agents: targets,
                method: 'symlink',
                projectRoot: '',
                contentDir,
            });
        } catch {
            continue; // unresolvable closure (e.g. dangling dependsOn) — skip, don't abort the whole reconciliation
        }
        for (const intent of intents) {
            const key = intentKey(intent);
            if (seen.has(key)) continue;
            seen.add(key);
            artifacts.push(intent);
        }
    }

    const enabledAgents = params.enabledAgents ?? getPreferences().enabledAgents;
    return planInstall({
        artifacts,
        selectedAgents: targets,
        enabledAgents,
        scope: 'global',
        projectRoot: '',
        method: 'symlink',
    });
}
