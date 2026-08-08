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
import { noteWindowsCaveat } from '../core/paths';
import { findProjectRoot, readProfile } from '../core/profile';
import {
    syncRegistries, readRegistriesConfig, verifyMinCliVersions, assertRegistryGates, RegistrySyncResult,
} from '../core/registries';
import { discoverAllBundles } from '../core/bundles';
import { syncProfile as realSyncProfile, SyncResult } from '../core/bundle-install';
import { verifyProjectPins, PinFailure } from '../core/profile-pins';
import { getPreferences } from '../utils/config';
import { resolveAgentTargetsOrError } from '../core/agent-targets';
import { reconcileProjectSkillLinks } from '../core/skill-integrity';
import { contentRoots } from '../core/registries';

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
    reconcileProjectSkillLinks: typeof reconcileProjectSkillLinks;
};

const defaultDeps: RunSyncDeps = {
    syncRegistries,
    verifyMinCliVersions,
    verifyProjectPins,
    syncProfile: realSyncProfile,
    reconcileProjectSkillLinks,
};

/** Un link curado o podado es un cambio en el arbol del usuario: se dice siempre.
 *  El silencio es lo que dejo este mantenimiento invisible durante todo su ciclo. */
function reportProjectLinkRepair(
    results: ReturnType<typeof reconcileProjectSkillLinks>,
): void {
    for (const { agent, result } of results) {
        for (const n of result.relinked) console.log(pc.green(`  ↻  Re-linked ${n} (${agent}, project scope)`));
        for (const n of result.pruned) console.log(pc.yellow(`  ✂  Pruned dangling ${n} (${agent}, project scope)`));
        for (const n of result.failed) console.warn(pc.yellow(`  ⚠  Could not repair ${n} (${agent}, project scope)`));
    }
}

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
    // Fires at most once per `awm sync` run, native Windows only — the single
    // emission point for this command (mirrors `runInit`/`runUpdateCore`).
    noteWindowsCaveat((m) => console.log(pc.dim(`ℹ ${m}`)));

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
    const resolved = resolveAgentTargetsOrError({ prefs, explicit: options.agent });
    if (!resolved.ok) {
        console.error(pc.red(resolved.error));
        return { code: 1, selectedAgents: [] };
    }
    const selectedAgents = resolved.targets;

    const syncResults = await d.syncRegistries();
    for (const r of syncResults) {
        if (r.action === 'error') console.warn(pc.yellow(`  ⚠  registry ${r.name}: ${r.error}`));
    }

    // Gate minCliVersion (WS-4) before pins (contract gates first — CONSTITUTION).
    try {
        assertRegistryGates(d.verifyMinCliVersions());
    } catch (e) {
        console.error(pc.red((e as Error).message));
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

    // Antes de instalar: sanear los links de skills que YA estan en el proyecto. Es lo
    // simetrico de `stepGlobalSkillsRepair` en `awm init`, que solo cubria el dir
    // global — un link colgante de proyecto (registry re-clonado, skill renombrada
    // upstream, bundle sacado del profile) no se curaba ni se podaba nunca. Corre
    // ANTES del early-return de "sin extensiones": un profile vacio es precisamente el
    // caso donde quedan huerfanos de una extension retirada, y era el unico camino que
    // salia sin tocar nada. Solo toca symlinks colgantes (`classifySkillLinks`).
    reportProjectLinkRepair(d.reconcileProjectSkillLinks(projectRoot, selectedAgents, contentRoots()));

    if (profile.extensions.length === 0) {
        console.log(pc.yellow('No extensions in .awm/profile.json — nothing to sync. Use `awm add <bundle>` first.'));
        return { code: 0, selectedAgents };
    }

    const method = options.method === 'copy' ? 'copy' : 'symlink';
    let result: SyncResult;
    try {
        result = d.syncProfile({ projectRoot, bundles: discoverAllBundles(), agents: selectedAgents, method });
    } catch (e) {
        console.error(pc.red((e as Error).message));
        return { code: 1, selectedAgents };
    }
    if (result.skipped.length > 0) {
        for (const sk of result.skipped) console.log(pc.yellow(`  ⚠  Skipped: ${sk}`));
    }
    const lines = result.installed.map((n) => pc.green(n)).join('\n  ');
    const installedNote = lines ? `\n  ${lines}` : pc.dim(' (all up to date)');
    console.log(`✅ Synced extensions [${result.extensions.join(', ')}]:${installedNote}`);
    // The transaction id is the ONLY handle `awm backup restore` accepts. It was
    // computed, returned in `transactionIds`, and then dropped on the floor by every
    // caller — so the operator who wanted to undo a sync had no name to give it.
    for (const id of result.transactionIds) {
        console.log(pc.dim(`  transaction ${id} — undo with \`awm backup restore ${id}\``));
    }

    return { code: 0, selectedAgents, result };
}
