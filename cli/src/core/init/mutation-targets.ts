// src/core/init/mutation-targets.ts
//
// Enumerates, WITHOUT writing anything, every filesystem path a real `awm
// init` run for a given agent is about to touch. `runInit` feeds this list to
// `beginBackupSession` (install-transaction.ts) BEFORE any step runs, so a
// failed init can roll every one of them back to its pre-run state.
//
// Deliberately generous rather than exhaustively precise: a path that ends up
// unused this run (e.g. an ambient bundle whose signal isn't present) is
// harmless to include — beginBackupSession just snapshots it (a no-op backup
// entry when nothing exists there yet). The one failure mode that matters is
// under-enumeration: a real write to a path NOT in this list would land
// outside the backup session and survive a rollback.
import path from 'path';
import { AgentTarget, ArtifactType, providerFor } from '../../providers';
import { defaultScopeForBundle, type BundleDefinition } from '../bundles';
import { expandBundleArtifacts } from '../bundle-install';
import { physicalTarget as resolvePhysicalTarget } from '../install-planner';
import { artifactStateFile } from '../artifact-state';
import { awmHome } from '../paths';
import { findProjectRoot, readProfile } from '../profile';
import { contentRoots } from '../registries';
import { projectContextPath } from '../context/materializer';

export type PlanInitMutationTargetsParams = {
    cwd: string;
    agent: AgentTarget;
    bundles: BundleDefinition[];
};

// Thin wrapper over install-planner.ts's `physicalTarget` (the single source
// of truth for the dir+filename computation, including the `.toml` rename for
// codex-agent-toml) — adapts its throw-on-unsupported contract to this
// module's null-on-unsupported one, and drops the `renderer` field this
// module's callers never needed.
function physicalTarget(
    type: ArtifactType,
    agent: AgentTarget,
    scope: 'global' | 'local',
    installName: string,
    projectRoot?: string,
): string | null {
    try {
        return resolvePhysicalTarget(
            { name: installName, installName, type, sourcePath: '' },
            agent,
            scope,
            projectRoot ?? '',
        ).targetPath;
    } catch {
        return null;
    }
}

function addBundleTargets(
    targets: Set<string>,
    bundleName: string,
    bundles: BundleDefinition[],
    agent: AgentTarget,
    scope: 'global' | 'local',
    projectRoot: string,
    contentDir: string,
): void {
    let intents;
    try {
        intents = expandBundleArtifacts({
            bundleName,
            bundles,
            agents: [agent],
            method: 'symlink',
            projectRoot,
            contentDir,
        });
    } catch {
        // Bundle not resolvable (e.g. missing dependency in a partially-seeded
        // test registry) — nothing to enumerate for it, not a hard failure.
        return;
    }
    for (const intent of intents) {
        const p = physicalTarget(intent.type, agent, scope, intent.installName, projectRoot);
        if (p) targets.add(p);
    }
}

/**
 * Enumerates every path `runInitSteps` may write to for `agent`, given the
 * discovered bundle catalog. Driven entirely by `agent` (the single target
 * being initialized this run) and `bundles` — not by preferences, since
 * enumeration never needs to know about any OTHER enabled agent's targets.
 * Pure / read-only (does hit the filesystem to discover project root and
 * read the project profile, but never writes).
 */
export function planInitMutationTargets(params: PlanInitMutationTargetsParams): string[] {
    const { cwd, agent, bundles } = params;
    const targets = new Set<string>();

    // preferences.json + the artifact ownership ledger (state/artifacts.json)
    targets.add(path.join(awmHome(), 'preferences.json'));
    targets.add(artifactStateFile());

    const provider = providerFor(agent);

    // hook: settings file (or hooks.json for codex) + the scripts directory it points at
    if (provider.hooks) {
        targets.add(provider.hooks.settingsPath);
        targets.add(provider.hooks.scriptsDir);
    }

    // Global skills directory itself, not just the bundle-derived skill
    // subdirectories enumerated below. stepGlobalSkillsRepair (steps.ts) calls
    // repairGlobalSkills, which readdirSync's the WHOLE skills dir and
    // rm/symlinks individual entries classified as repairable/dead — i.e.
    // entries that, by definition, don't belong to any currently-known
    // bundle, so they can never be enumerated by addBundleTargets below.
    // Adding the parent directory here makes beginBackupSession snapshot the
    // whole tree (backupEntryFor does a recursive fs.cpSync for directory
    // targets — verified in install-transaction.ts), covering any entry that
    // repair might mutate. Broad-but-safe, per this module's own philosophy.
    if (provider.skill.global !== null) targets.add(provider.skill.global);

    // global context / AGENTS.md injection (covered by the hook for claude-code)
    const injection = provider.injection;
    if (injection) {
        if (injection.type === 'config-instructions') targets.add(injection.configPath);
        if (injection.type === 'managed-agents-md' && injection.globalPath !== null) targets.add(injection.globalPath);
    }

    // machine-level bundle targets: baseline (dev-core) + ambient, global scope
    const roots = contentRoots();
    const contentDir = roots[0] ?? '';
    const machineBundles = bundles.filter((b) => b.scope === 'baseline' || b.scope === 'ambient');
    for (const b of machineBundles) {
        addBundleTargets(targets, b.name, bundles, agent, 'global', cwd, contentDir);
    }

    // project-level: profile, sensors manifest, project injection, and every
    // extension currently recorded in .awm/profile.json
    const projectRoot = findProjectRoot(cwd);
    if (projectRoot) {
        targets.add(path.join(projectRoot, '.awm', 'profile.json'));
        targets.add(path.join(projectRoot, '.awm', 'sensors.json'));
        if (injection?.type === 'config-instructions') {
            targets.add(path.join(projectRoot, path.basename(injection.configPath)));
        }
        if (injection?.type === 'managed-agents-md') {
            targets.add(path.join(projectRoot, path.basename(injection.localFile)));
            if (injection.globalPath === null) {
                // Local-scope context injection (Cursor/Copilot — stepContextInjection,
                // steps.ts) materializes its source content under the project root before
                // writing it into the AGENTS.md target above; that materialized file is a
                // real write this run can make and was previously absent from this
                // enumeration entirely.
                targets.add(projectContextPath(projectRoot));
            }
        }
        if (agent === 'cursor') {
            // CodexAgentsStrategy.injectProject's redundant always-on carrier
            // (codex-agents.ts) — written whenever agent === 'cursor', independent of
            // the managed-agents-md branch above.
            targets.add(path.join(projectRoot, '.cursor', 'rules', 'awm.mdc'));
        }

        let profile;
        try {
            profile = readProfile(projectRoot);
        } catch {
            profile = { extensions: [] as string[] };
        }
        for (const ext of profile.extensions) {
            const extBundle = bundles.find((b) => b.name === ext);
            if (!extBundle) continue;
            const scope = defaultScopeForBundle(extBundle.scope);
            addBundleTargets(targets, ext, bundles, agent, scope, projectRoot, contentDir);
        }
    }

    return Array.from(targets);
}
