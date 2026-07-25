// src/core/bundle-install.ts
import fs from 'fs';
import path from 'path';
import {
    BundleDefinition,
    defaultScopeForBundle,
    resolveBundleClosure,
} from './bundles';
import { AgentTarget, providerFor, Scope } from '../providers';
import { addExtension, ensureSkillsGitignored, readProfile, shouldRecordExtension } from './profile';
import { contentRoots } from './registries';
import { getPreferences } from '../utils/config';
import { ArtifactIntent, InstallPlan, planInstall } from './install-planner';
import { applyInstallPlan as realApplyInstallPlan, InstallSummary } from './install-transaction';

export type { InstallSummary } from './install-transaction';

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
     * Injectable seam over the real `applyInstallPlan` (install-transaction.ts)
     * — defaults to it. Tests inject a fake here when they want to assert on
     * the computed InstallPlan without touching the filesystem.
     */
    applyPlan?: (plan: InstallPlan) => InstallSummary;
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

/**
 * Materializes a bundle and its dependency closure into the target agents.
 *
 * `expandBundleArtifacts` turns the bundle closure into artifact intents,
 * `planInstall` turns those into a deduped, ownership-tracked plan (see
 * install-planner.ts for the shared-target and ownership rules), and
 * `applyInstallPlan` (install-transaction.ts) performs the actual
 * transactional filesystem apply — backups before any replace, rollback on
 * verification failure, artifact-state persistence on success.
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
    const apply = opts.applyPlan ?? realApplyInstallPlan;
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
    // Check the named bundle's OWN artifacts (not the dependency closure) were
    // installed — i.e. at least one own artifact has a source on disk AND a
    // type supported by at least one selected agent (matching what planInstall
    // would actually materialize). ArtifactIntent/PlannedOperation carry no
    // bundle provenance (install-planner.ts groups purely by physical target),
    // so this is computed directly from the bundle's own artifact list rather
    // than by inspecting `summary.installed`.
    const ownInstalled = target
        ? bundleArtifacts(target, target.contentRoot ?? opts.contentDir ?? contentRoots()[0] ?? '')
            .some((artifact) =>
                fs.existsSync(artifact.sourcePath) &&
                opts.agents.some((agent) => providerFor(agent)[artifact.type] !== null))
        : false;
    if (target && ownInstalled) {
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

export interface SyncResult extends Omit<InstallSummary, 'transactionId'> {
    extensions: string[];
    /** One transaction ID per bundle actually installed during this sync, in order — a multi-bundle sync runs one applyInstallPlan transaction per bundle. */
    transactionIds: string[];
}

/**
 * Rebuilds local symlinks from `.awm/profile.json` — each listed extension is
 * installed locally (with its dependency closure). Does not modify the profile.
 */
export function syncProfile(opts: SyncProfileOptions): SyncResult {
    const profile = readProfile(opts.projectRoot);
    const installed: string[] = [];
    const skipped: string[] = [];
    const modifiedFiles: string[] = [];
    const transactionIds: string[] = [];

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
        modifiedFiles.push(...summary.modifiedFiles);
        transactionIds.push(summary.transactionId);
    }

    if (profile.extensions.length > 0) ensureSkillsGitignored(opts.projectRoot, opts.agents);

    return { installed, skipped, extensions: profile.extensions, transactionIds, modifiedFiles };
}
