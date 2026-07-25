// src/core/bundle-install.ts
import {
    BundleDefinition,
    defaultScopeForBundle,
    resolveBundleClosure,
} from './bundles';
import { AgentTarget, Scope } from '../providers';
import { addExtension, ensureSkillsGitignored, readProfile, shouldRecordExtension } from './profile';
import { contentRoots } from './registries';
import { getPreferences } from '../utils/config';
import { ArtifactIntent, InstallPlan, planInstall } from './install-planner';
import path from 'path';

export type InstallMethod = 'symlink' | 'copy';

export interface InstallBundleOptions {
    bundleName: string;
    bundles: BundleDefinition[];
    agents: AgentTarget[];
    method: InstallMethod;
    projectRoot: string;
    /** Applies only to the named bundle; dependencies always use their default scope. */
    scopeOverride?: Scope;
    /** Registry content root (defaults to the real cache). Overridable for tests. */
    contentDir?: string;
    /**
     * Injectable seam for the not-yet-implemented Task 6 `applyInstallPlan`
     * (transactional filesystem apply + backups/rollback + artifact-state
     * persistence). Tests that need `installBundle`/`addBundle`/`syncProfile`
     * to actually materialize artifacts must supply this until Task 6 lands
     * the real implementation. Omitting it throws.
     */
    applyPlan?: (plan: InstallPlan) => InstallSummary;
}

export interface InstallSummary {
    installed: string[];
    skipped: string[];
}

function bundleArtifacts(b: BundleDefinition, contentDir: string): ArtifactIntent[] {
    const refs: ArtifactIntent[] = [];
    for (const s of b.skills) {
        refs.push({ name: s.name, type: 'skill', installName: s.name, sourcePath: path.join(contentDir, 'skills', s.name) });
    }
    for (const w of b.workflows) {
        refs.push({ name: w, type: 'workflow', installName: `${w}.md`, sourcePath: path.join(contentDir, 'workflows', `${w}.md`) });
    }
    for (const a of b.agents) {
        refs.push({ name: a, type: 'agent', installName: `${a}.md`, sourcePath: path.join(contentDir, 'agents', `${a}.md`) });
    }
    return refs;
}

/**
 * Expands a bundle and its dependency closure into the flat list of artifact
 * intents to install. Pure — resolves the closure and content roots but
 * performs no filesystem writes and no agent/scope resolution; that's
 * `planInstall`'s job.
 */
export function expandBundleArtifacts(opts: InstallBundleOptions): ArtifactIntent[] {
    const fallbackContentDir = opts.contentDir ?? contentRoots()[0] ?? '';
    const closure = resolveBundleClosure(opts.bundleName, opts.bundles);
    return closure.flatMap((b) => bundleArtifacts(b, b.contentRoot ?? fallbackContentDir));
}

// KNOWN RED (Task 6): every real caller of installBundle/addBundle/syncProfile
// that doesn't inject `opts.applyPlan` hits this throw — that includes actual
// CLI code paths, not just test fixtures: `awm init`'s defaultActions
// (src/core/init/steps.ts), `awm add`'s post-add bundle install
// (src/commands/registry/install-bundles.ts), and multi-root bundle installs.
// Those code paths are non-functional until Task 6 lands the real
// applyInstallPlan (transactional filesystem apply + backups/rollback +
// artifact-state persistence).
function applyInstallPlan(_plan: InstallPlan): InstallSummary {
    throw new Error('applyInstallPlan is not implemented yet (Task 6)');
}

/**
 * Materializes a bundle and its dependency closure into the target agents.
 *
 * TASK 5 INTERIM STATE: this is now a thin façade — `expandBundleArtifacts`
 * turns the bundle closure into artifact intents, `planInstall` turns those
 * into a deduped, ownership-tracked plan (see install-planner.ts for the
 * shared-target and ownership rules), and the actual transactional
 * filesystem apply is Task 6's `applyInstallPlan`. Until Task 6 lands, pass
 * `opts.applyPlan` to inject a stub/fake; without it this throws.
 *
 * Note: unlike the pre-Task-5 implementation, scope is now resolved once for
 * the whole call (the named bundle's own scope, or `scopeOverride`) rather
 * than per-bundle-in-closure; dependency bundles with a *different* default
 * scope than the named bundle no longer get their own scope. This matches
 * the plan for Task 5's `planInstall` signature (single `scope` param) and is
 * expected to be revisited if that distinction turns out to matter.
 */
export function installBundle(opts: InstallBundleOptions): InstallSummary {
    const intents = expandBundleArtifacts(opts);
    const enabledAgents = getPreferences().enabledAgents;
    const plan = planInstall({
        artifacts: intents,
        selectedAgents: opts.agents,
        enabledAgents,
        scope: opts.scopeOverride ?? defaultScopeForBundle(
            opts.bundles.find((bundle) => bundle.name === opts.bundleName)?.scope ?? 'baseline',
        ),
        projectRoot: opts.projectRoot,
        method: opts.method,
    });
    const apply = opts.applyPlan ?? applyInstallPlan;
    return apply(plan);
}

export interface AddBundleResult extends InstallSummary {
    /** The bundle name recorded as a project extension, or null if not recorded. */
    recordedExtension: string | null;
}

/**
 * Installs a bundle (closure) and, when it is a project-scope bundle installed
 * locally, records it as an extension in `.awm/profile.json` and ensures the
 * local symlinks are gitignored. Dependencies are never recorded.
 */
export function addBundle(opts: InstallBundleOptions): AddBundleResult {
    const summary = installBundle(opts);
    const target = opts.bundles.find((b) => b.name === opts.bundleName);

    let recordedExtension: string | null = null;
    // Check the named bundle's own artifacts (not just closure deps) were installed.
    // KNOWN GAP (Task 6): this greps `summary.installed` for a `[bundleName]`
    // suffix, but ArtifactIntent/PlannedOperation (install-planner.ts) carry no
    // bundle provenance — only artifact name/type/owners — so no applyPlan
    // implementation can produce that suffix anymore. `ownInstalled` is
    // therefore always empty and `recordedExtension` always null until Task 6
    // either adds bundle provenance to the plan or redesigns this check to
    // compare against the named bundle's own artifact list directly.
    const ownInstalled = summary.installed.filter((line) => line.endsWith(`[${opts.bundleName}]`));
    if (target && ownInstalled.length > 0) {
        const effective: Scope = opts.scopeOverride ?? defaultScopeForBundle(target.scope);
        if (shouldRecordExtension(target.scope, effective)) {
            addExtension(opts.projectRoot, opts.bundleName);
            ensureSkillsGitignored(opts.projectRoot, opts.agents);
            recordedExtension = opts.bundleName;
        }
    }

    return { ...summary, recordedExtension };
}

export interface SyncProfileOptions {
    projectRoot: string;
    bundles: BundleDefinition[];
    agents: AgentTarget[];
    method: InstallMethod;
    contentDir?: string;
    /** See InstallBundleOptions.applyPlan. */
    applyPlan?: (plan: InstallPlan) => InstallSummary;
}

export interface SyncResult extends InstallSummary {
    extensions: string[];
}

/**
 * Rebuilds local symlinks from `.awm/profile.json` — each listed extension is
 * installed locally (with its dependency closure). Does not modify the profile.
 */
export function syncProfile(opts: SyncProfileOptions): SyncResult {
    const profile = readProfile(opts.projectRoot);
    const installed: string[] = [];
    const skipped: string[] = [];

    for (const ext of profile.extensions) {
        if (!opts.bundles.some((b) => b.name === ext)) {
            skipped.push(`${ext} (bundle not found in registry — remove with \`awm remove ${ext}\`)`);
            continue;
        }
        const summary = installBundle({
            bundleName: ext,
            bundles: opts.bundles,
            agents: opts.agents,
            method: opts.method,
            projectRoot: opts.projectRoot,
            contentDir: opts.contentDir,
            applyPlan: opts.applyPlan,
        });
        installed.push(...summary.installed);
        skipped.push(...summary.skipped);
    }

    if (profile.extensions.length > 0) ensureSkillsGitignored(opts.projectRoot, opts.agents);

    return { installed, skipped, extensions: profile.extensions };
}
