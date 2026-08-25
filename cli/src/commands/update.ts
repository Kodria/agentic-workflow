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
import { normalizePin } from '../core/versioning';
import { noteWindowsCaveat } from '../core/paths';
import { getPreferences } from '../utils/config';
import { resolveAgentTargetsOrError } from '../core/agent-targets';
import {
    syncRegistries, verifyMinCliVersions, assertRegistryGates, contentRoots, capabilityRoot,
    assertSyncedRegistriesUsable, RegistrySyncResult,
} from '../core/registries';
import { awmHome } from '../core/paths';
import { regenerateGlobalContext, RegenResult } from '../core/context/regenerate';
import { planReconciliation } from '../core/reconciliation';
import { applyInstallPlan as realApplyInstallPlan, InstallSummary } from '../core/install-transaction';
import { InstallPlan } from '../core/install-planner';
import { resyncInstalledHooks, ResyncResult } from '../commands/hooks/resync';
// `core/update-check.ts` imports `@clack/prompts` (ESM-only) at its top level
// for its interactive confirm() prompt — required lazily below, inside the
// default dep, so `require()`-ing this module for `runUpdateCore` alone never
// pulls it in. `import type` es la única forma de nombrar su tipo acá: TS lo
// borra al compilar, así que no genera el `require` que rompería a los tests.
import type { SelfUpdateMode } from '../core/update-check';

export type RunUpdateOptions = {
    agent?: string;
    /** No interactivo con consentimiento explícito: no pregunta y SÍ hace el self-update. */
    yes?: boolean;
};

export type RunUpdateDeps = {
    syncRegistries: () => Promise<RegistrySyncResult[]>;
    verifyMinCliVersions: () => ReturnType<typeof verifyMinCliVersions>;
    regenerateGlobalContext: (targets: AgentTarget[]) => RegenResult[];
    planReconciliation: (params: { targets: AgentTarget[]; roots: string[] }) => InstallPlan;
    applyInstallPlan: (plan: InstallPlan) => InstallSummary;
    resyncInstalledHooks: (registryRoot: string, targets: AgentTarget[]) => ResyncResult[];
    offerSelfUpdate: (mode?: SelfUpdateMode) => Promise<void>;
};

const defaultDeps: RunUpdateDeps = {
    syncRegistries,
    verifyMinCliVersions,
    regenerateGlobalContext,
    planReconciliation,
    applyInstallPlan: realApplyInstallPlan,
    resyncInstalledHooks,
    offerSelfUpdate: async (mode?: SelfUpdateMode) => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { offerSelfUpdate: real } = require('../core/update-check');
        await real({ mode });
    },
};

/** Qué le pasó realmente a los registries en esta corrida. El mensaje de cierre se
 *  DERIVA de esto (ver `updateOutro`) en vez de ser un literal fijo: un literal solo
 *  puede decir "actualizado", incluso cuando no se actualizó nada. */
export type RegistryOutcome = {
    /** Registries configurados en esta máquina. 0 = máquina sin `awm init`. */
    configured: number;
    /** Los que se sincronizaron sin error. */
    synced: number;
    /** Nombres de los que fallaron (usables o no). */
    failed: string[];
};

export type RunUpdateResult = {
    code: number;
    selectedAgents: AgentTarget[];
    registries: RegistryOutcome;
};

const NO_REGISTRIES: RegistryOutcome = { configured: 0, synced: 0, failed: [] };

/**
 * El texto de cierre, derivado del resultado. Vive acá y no en la registración de
 * Commander porque el literal de `index.ts` era el defecto: decía
 * "✅ Registries, skills and hooks updated." con `code === 0`, y `code` valía 0 pase lo
 * que pase — así que una máquina SIN NINGÚN registry configurado recibía la confirmación
 * de que se le habían actualizado los registries, los skills y los hooks. Un comando que
 * miente es peor que uno que falla: el que falla te manda a mirar, el que miente te manda
 * a otro lado a buscar el problema.
 */
export function updateOutro(result: RunUpdateResult): string {
    const { registries: reg } = result;
    if (reg.configured === 0) return 'Nothing updated — no registries configured on this machine.';
    if (result.code !== 0) return 'Update failed — see errors above.';
    if (reg.failed.length > 0) {
        return `⚠ Updated with stale content — ${reg.synced}/${reg.configured} registries synced, `
            + `kept on-disk content for: ${reg.failed.join(', ')}.`;
    }
    return `✅ ${reg.synced} ${reg.synced === 1 ? 'registry' : 'registries'}, skills and hooks updated.`;
}

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
    // Fires at most once per `awm update` run, native Windows only — the
    // single emission point for this command (mirrors `runInit`/`runSyncCore`).
    noteWindowsCaveat((m) => console.log(pc.dim(`ℹ ${m}`)));

    const d: RunUpdateDeps = { ...defaultDeps, ...deps };
    const prefs = getPreferences();

    const resolved = resolveAgentTargetsOrError({ prefs, explicit: options.agent });
    if (!resolved.ok) {
        console.error(pc.red(resolved.error));
        return { code: 1, selectedAgents: [], registries: NO_REGISTRIES };
    }
    const selectedAgents = resolved.targets;

    const registryResults = await d.syncRegistries();
    for (const r of registryResults) {
        if (r.action === 'error') console.warn(pc.yellow(`  ⚠  registry ${r.name}: ${r.error}`));
        else if (r.disposition === 'regressed') {
            const latest = r.availableVersion && r.availableVersion !== r.version
                ? ` Latest available: ${r.availableVersion}.`
                : '';
            console.warn(pc.yellow(
                `  ⚠ Registry ${r.name} regressed ${r.previousVersion ?? '(previous version)'} → ${r.version} `
                + `because it is pinned to v${normalizePin(r.pin ?? '')}.${latest} Run \`awm unpin ${r.name}\` to move forward.`,
            ));
        } else if (r.pin && r.availableVersion !== r.version) {
            console.log(pc.yellow(
                `  ✓ Registry ${r.name} resolved @ ${r.version} (pinned to v${normalizePin(r.pin)}; `
                + `latest available: ${r.availableVersion ?? 'unknown'}). Run \`awm unpin ${r.name}\` to move forward.`,
            ));
        } else if (r.disposition === 'unchanged') {
            console.log(pc.dim(`  ✓ Registry ${r.name} already at ${r.version}`));
        } else if (r.disposition === 'advanced') {
            console.log(pc.green(`  ✓ Registry ${r.name} updated @ ${r.version}`));
        } else if (r.disposition === 'installed') {
            console.log(pc.green(`  ✓ Registry ${r.name} installed @ ${r.version}`));
        } else {
            console.log(pc.green(`  ✓ Registry ${r.name} resolved @ ${r.version}`));
        }
    }
    const registries: RegistryOutcome = {
        configured: registryResults.length,
        synced: registryResults.filter((r) => r.action !== 'error').length,
        failed: registryResults.filter((r) => r.action === 'error').map((r) => r.name),
    };

    // Cero registries no es "todo al día": es una máquina que nunca corrió `awm init`
    // (o cuyo registries.json se perdió). Seguir adelante regenera contexto vacío,
    // reconcilia contra cero content roots y no re-sincroniza ningún hook — cada etapa
    // "pasa" porque no tiene nada que hacer, y el comando terminaba anunciando éxito.
    // Se corta acá, nombrando el archivo que falta y el comando que lo crea.
    if (registries.configured === 0) {
        console.error(pc.red(`No registries configured in ${awmHome()} — nothing to update.`));
        console.error(pc.dim("  This machine was never initialized: run 'awm init' first."));
        return { code: 1, selectedAgents, registries };
    }

    // Falla CERRADO solo cuando el registry quedó sin contenido en disco: ahí lo que sigue
    // leería un árbol inexistente y el fallo reaparecería más tarde, disfrazado de otra
    // etapa. Un registry que falló pero conserva su contenido queda stale, no roto — se
    // sigue (doctrina de `unusableSyncedRegistries`: un registry secundario flaky nunca
    // aborta la corrida) y el cierre lo nombra en vez de declarar éxito parejo.
    try {
        assertSyncedRegistriesUsable(registryResults);
    } catch (e) {
        console.error(pc.red((e as Error).message));
        return { code: 1, selectedAgents, registries };
    }

    try {
        assertRegistryGates(d.verifyMinCliVersions());
    } catch (e) {
        console.error(pc.red((e as Error).message));
        return { code: 1, selectedAgents, registries };
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
        return { code: 1, selectedAgents, registries };
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
            return { code: 1, selectedAgents, registries };
        }
    }

    // `--yes` es consentimiento explícito para reemplazar el binario global. Sin él se
    // pasa `undefined` a propósito, para que la decisión la tome `defaultSelfUpdateMode()`
    // según haya o no un humano en stdin — no este llamador.
    await d.offerSelfUpdate(options.yes === true ? 'assume-yes' : undefined);

    return { code: 0, selectedAgents, registries };
}
