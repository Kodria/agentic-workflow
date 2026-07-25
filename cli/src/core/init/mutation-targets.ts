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
import { AgentTarget, providerFor } from '../../providers';
import type { AwmPreferences } from '../../utils/config';
import { defaultScopeForBundle, type BundleDefinition } from '../bundles';
import { expandBundleArtifacts } from '../bundle-install';
import { artifactStateFile } from '../artifact-state';
import { awmHome } from '../paths';
import { findProjectRoot, readProfile } from '../profile';
import { contentRoots } from '../registries';

export type PlanInitMutationTargetsParams = {
    cwd: string;
    agent: AgentTarget;
    preferences: AwmPreferences;
    bundles: BundleDefinition[];
};

function physicalTarget(
    type: 'skill' | 'workflow' | 'agent',
    agent: AgentTarget,
    scope: 'global' | 'local',
    installName: string,
    projectRoot?: string,
): string | null {
    const config = providerFor(agent)[type];
    if (!config) return null;
    const dir = scope === 'local' ? path.join(projectRoot ?? '', config.local) : config.global;
    const filename = config.renderer === 'codex-agent-toml'
        ? `${path.parse(installName).name}.toml`
        : installName;
    return path.join(dir, filename);
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
 * current preferences and discovered bundle catalog. Pure / read-only (does
 * hit the filesystem to discover project root and read the project profile,
 * but never writes).
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

    // global context / AGENTS.md injection (covered by the hook for claude-code)
    const injection = provider.injection;
    if (injection) {
        if (injection.type === 'config-instructions') targets.add(injection.configPath);
        if (injection.type === 'managed-agents-md') targets.add(injection.globalPath);
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
