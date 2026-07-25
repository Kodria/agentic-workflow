// src/commands/add.ts
//
// `awm add <bundle>` — the non-interactive, headless bundle-activation path
// of `awm add` (works without a TTY, unlike the interactive artifact
// picker). Resolves agent targets the same way as `remove`/`sync`/`update`/
// `doctor` (R12/R13): every enabled agent when `--agent` is absent, or an
// explicit comma-separated subset validated against `enabledAgents`.
import pc from 'picocolors';
import { AgentTarget, Scope } from '../providers';
import { AwmPreferences } from '../utils/config';
import { resolveAgentTargetsOrError } from '../core/agent-targets';
import { BundleDefinition, defaultScopeForBundle } from '../core/bundles';
import { addBundle as realAddBundle, AddBundleResult } from '../core/bundle-install';
import { findProjectRoot } from '../core/profile';

export type RunAddBundleOptions = {
    name: string;
    agent?: string;
    scope?: string;
    cwd?: string;
};

export type RunAddBundleDeps = {
    addBundle: typeof realAddBundle;
};

export type RunAddBundleResult = {
    code: number;
    selectedAgents: AgentTarget[];
    result?: AddBundleResult;
};

/**
 * Installs `options.name`'s bundle closure for the resolved agent targets.
 * Pure-ish: the only side effect is the injected `addBundle` (defaults to
 * the real one). Returns a result object rather than calling `process.exit`
 * so it's directly testable and composable with `index.ts`'s Commander
 * action (which does the console output / exit-code translation).
 */
export function runAddBundleCore(
    options: RunAddBundleOptions,
    prefs: AwmPreferences,
    bundles: BundleDefinition[],
    deps: Partial<RunAddBundleDeps> = {},
): RunAddBundleResult {
    const d: RunAddBundleDeps = { addBundle: realAddBundle, ...deps };
    const matchedBundle = bundles.find((b) => b.name === options.name);
    if (!matchedBundle) {
        console.error(pc.red(`Bundle "${options.name}" not found in registry.`));
        console.error(pc.dim('Run `awm list` to see available packages.'));
        return { code: 1, selectedAgents: [] };
    }

    const resolved = resolveAgentTargetsOrError({ prefs, explicit: options.agent });
    if (!resolved.ok) {
        console.error(pc.red(resolved.error));
        return { code: 1, selectedAgents: [] };
    }
    const selectedAgents = resolved.targets;

    let scopeOverride: Scope | undefined;
    if (options.scope) {
        if (!['local', 'global'].includes(options.scope)) {
            console.error(pc.red(`Invalid scope "${options.scope}". Use: local or global.`));
            return { code: 1, selectedAgents };
        }
        scopeOverride = options.scope as Scope;
    }

    const effective = scopeOverride ?? defaultScopeForBundle(matchedBundle.scope);
    const cwd = options.cwd ?? process.cwd();
    const projectRoot = findProjectRoot(cwd);
    if (effective === 'local' && !projectRoot) {
        console.error(pc.red('No project root found (need a .git/, package.json, or .awm/profile.json here). Run inside a project, or pass --global.'));
        return { code: 1, selectedAgents };
    }

    let result: AddBundleResult;
    try {
        result = d.addBundle({
            bundleName: matchedBundle.name,
            bundles,
            agents: selectedAgents,
            method: 'symlink',
            projectRoot: projectRoot ?? cwd,
            scopeOverride,
        });
    } catch (e) {
        console.error(pc.red((e as Error).message));
        return { code: 1, selectedAgents };
    }

    if (result.skipped.length > 0) {
        for (const s of result.skipped) console.log(pc.yellow(`  ⚠  Skipped: ${s}`));
    }
    if (result.installed.length === 0) {
        console.log(pc.yellow(`Nothing installed for bundle "${matchedBundle.name}".`));
        return { code: 0, selectedAgents, result };
    }
    const lines = result.installed.map((n) => pc.green(n)).join('\n  ');
    const recordNote = result.recordedExtension
        ? `\n\n${pc.dim('Recorded as a project extension in .awm/profile.json (commit it; symlinks are gitignored).')}`
        : '';
    console.log(`✅ Installed bundle ${pc.cyan(matchedBundle.name)}:\n  ${lines}${recordNote}`);
    return { code: 0, selectedAgents, result };
}
