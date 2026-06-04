// src/core/bundle-install.ts
import fs from 'fs';
import path from 'path';
import {
    BundleDefinition,
    REGISTRY_CONTENT_DIR,
    defaultScopeForBundle,
    resolveBundleClosure,
} from './bundles';
import { installArtifact } from './executor';
import { AgentTarget, ArtifactType, Scope, getTargetPath, PROVIDERS } from '../providers';
import { addExtension, ensureSkillsGitignored, shouldRecordExtension } from './profile';

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
}

export interface InstallSummary {
    installed: string[];
    skipped: string[];
}

interface ArtifactRef {
    name: string;
    type: ArtifactType;
    installName: string;
    sourcePath: string;
}

function bundleArtifacts(b: BundleDefinition, contentDir: string): ArtifactRef[] {
    const refs: ArtifactRef[] = [];
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
 * Materializes a bundle and its dependency closure into the target agents.
 * The named bundle uses `scopeOverride` if given; dependencies always use
 * their own default scope (baseline→global, project→local, ambient→global).
 * Local installs resolve under `projectRoot`; global installs use the
 * provider's absolute global path. Unsupported artifact types per agent and
 * missing sources are skipped (never thrown).
 */
export function installBundle(opts: InstallBundleOptions): InstallSummary {
    const contentDir = opts.contentDir ?? REGISTRY_CONTENT_DIR;
    const closure = resolveBundleClosure(opts.bundleName, opts.bundles);
    const installed: string[] = [];
    const skipped: string[] = [];

    for (const b of closure) {
        const scope: Scope =
            b.name === opts.bundleName
                ? opts.scopeOverride ?? defaultScopeForBundle(b.scope)
                : defaultScopeForBundle(b.scope);

        for (const art of bundleArtifacts(b, contentDir)) {
            if (!fs.existsSync(art.sourcePath)) {
                skipped.push(`${art.name} (source missing: ${art.sourcePath})`);
                continue;
            }
            for (const agent of opts.agents) {
                if (PROVIDERS[agent][art.type] === null) {
                    skipped.push(`${art.name} (${agent}: ${art.type} unsupported)`);
                    continue;
                }
                const rel = getTargetPath(art.type, agent, scope);
                const baseDir = scope === 'local' ? path.join(opts.projectRoot, rel) : rel;
                const dest = path.join(baseDir, art.installName);
                installArtifact(art.sourcePath, dest, opts.method);
                installed.push(`${art.name} → ${agent} (${scope}) [${b.name}]`);
            }
        }
    }

    return { installed, skipped };
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
    if (target) {
        const effective: Scope = opts.scopeOverride ?? defaultScopeForBundle(target.scope);
        if (shouldRecordExtension(target.scope, effective)) {
            addExtension(opts.projectRoot, opts.bundleName);
            ensureSkillsGitignored(opts.projectRoot);
            recordedExtension = opts.bundleName;
        }
    }

    return { ...summary, recordedExtension };
}
