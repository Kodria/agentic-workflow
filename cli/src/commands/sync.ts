// src/commands/sync.ts
//
// `awm sync` — rebuilds local skill/workflow/agent symlinks from
// `.awm/profile.json` for the resolved agent targets (R12/R13): defaults to
// every enabled agent when `--agent` is absent, otherwise an explicit
// comma-separated subset (validated against `enabledAgents`).
// NOTE: deliberately no top-level `@clack/prompts` import here — this module
// is `require()`d directly by tests exercising `runSyncCore`, and `@clack/prompts`
// ships ESM-only, which the CommonJS ts-jest transform can't load. The
// intro/outro chrome lives in `index.ts`'s Commander registration instead
// (which already imports clack at the top and is never `require()`d by tests).
import pc from 'picocolors';
import { AgentTarget } from '../providers';
import { findProjectRoot, readProfile } from '../core/profile';
import {
    syncRegistries, readRegistriesConfig, verifyMinCliVersions, RegistrySyncResult,
} from '../core/registries';
import { cliVersion } from '../core/cli-version';
import { discoverAllBundles } from '../core/bundles';
import { syncProfile as realSyncProfile, SyncResult } from '../core/bundle-install';
import { verifyProjectPins, PinFailure } from '../core/profile-pins';
import { getPreferences } from '../utils/config';
import { resolveAgentTargets } from '../core/agent-targets';

export type RunSyncOptions = {
    cwd?: string;
    agent?: string;
    method?: string;
};

export type RunSyncDeps = {
    syncRegistries: () => Promise<RegistrySyncResult[]>;
    verifyMinCliVersions: () => ReturnType<typeof verifyMinCliVersions>;
    verifyProjectPins: (pins: Record<string, string>) => Promise<PinFailure[]>;
    syncProfile: typeof realSyncProfile;
};

const defaultDeps: RunSyncDeps = {
    syncRegistries,
    verifyMinCliVersions,
    verifyProjectPins,
    syncProfile: realSyncProfile,
};

export type RunSyncResult = {
    code: number;
    selectedAgents: AgentTarget[];
    result?: SyncResult;
};

/** Core, UI-free `awm sync` logic — see `runSync` for the Commander-facing wrapper. */
export async function runSyncCore(
    options: RunSyncOptions,
    deps: Partial<RunSyncDeps> = {},
): Promise<RunSyncResult> {
    const d: RunSyncDeps = { ...defaultDeps, ...deps };
    const cwd = options.cwd ?? process.cwd();

    const projectRoot = findProjectRoot(cwd);
    if (!projectRoot) {
        console.error(pc.red('No project root found (need a .git/, package.json, or .awm/profile.json here).'));
        return { code: 1, selectedAgents: [] };
    }

    let profile;
    try {
        profile = readProfile(projectRoot);
    } catch (e) {
        console.error(pc.red((e as Error).message));
        return { code: 1, selectedAgents: [] };
    }

    const prefs = getPreferences();
    let selectedAgents: AgentTarget[];
    try {
        selectedAgents = resolveAgentTargets({ prefs, explicit: options.agent });
    } catch (e) {
        console.error(pc.red((e as Error).message));
        return { code: 1, selectedAgents: [] };
    }

    const syncResults = await d.syncRegistries();
    for (const r of syncResults) {
        if (r.action === 'error') console.warn(pc.yellow(`  ⚠  registry ${r.name}: ${r.error}`));
    }

    // Gate minCliVersion (WS-4) before pins (contract gates first — CONSTITUTION).
    const cliFailures = d.verifyMinCliVersions();
    if (cliFailures.length > 0) {
        for (const f of cliFailures) {
            console.error(pc.red(`Registry ${f.name} requires CLI >= ${f.min} (you have ${cliVersion()}).`));
            console.error(pc.red('  Run: npm i -g agentic-workflow-manager'));
        }
        return { code: 1, selectedAgents };
    }

    const pins = profile.registries ?? {};
    if (Object.keys(pins).length > 0) {
        const failures = await d.verifyProjectPins(pins);
        if (failures.length > 0) {
            for (const f of failures) {
                if (f.reason === 'missing-registry') {
                    const registriesConfig = readRegistriesConfig();
                    const isConfigured = registriesConfig.some((r) => r.name === f.name);
                    if (isConfigured) {
                        console.error(pc.red(`The registry "${f.name}" is configured but not yet synced on this machine. Run: awm update`));
                    } else {
                        console.error(pc.red(`The registry "${f.name}" is not configured on this machine. Run: awm registry add <remote>`));
                    }
                } else {
                    console.error(pc.red(`This machine has ${f.name} @ ${f.actual ? `v${f.actual}` : 'HEAD (no tag)'} but the project requires v${f.required}.`));
                    console.error(pc.red(`  Run: awm pin ${f.name} ${f.required} && awm update`));
                }
            }
            return { code: 1, selectedAgents };
        }
    }

    if (profile.extensions.length === 0) {
        console.log(pc.yellow('No extensions in .awm/profile.json — nothing to sync. Use `awm add <bundle>` first.'));
        return { code: 0, selectedAgents };
    }

    const method = options.method === 'copy' ? 'copy' : 'symlink';
    const result = d.syncProfile({ projectRoot, bundles: discoverAllBundles(), agents: selectedAgents, method });
    if (result.skipped.length > 0) {
        for (const sk of result.skipped) console.log(pc.yellow(`  ⚠  Skipped: ${sk}`));
    }
    const lines = result.installed.map((n) => pc.green(n)).join('\n  ');
    const installedNote = lines ? `\n  ${lines}` : pc.dim(' (all up to date)');
    console.log(`✅ Synced extensions [${result.extensions.join(', ')}]:${installedNote}`);

    return { code: 0, selectedAgents, result };
}
