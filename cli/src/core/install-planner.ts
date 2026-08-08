// src/core/install-planner.ts
//
// Pure planning layer for artifact install/removal: no filesystem writes.
// Given artifact intents and a set of agent targets, computes the physical
// operations to perform, deduping targets that multiple agents' provider
// configs happen to resolve to the same directory (e.g. OpenCode and Codex
// both point their `skill` config at ~/.agents/skills), and tracks ownership
// so a later removal can tell whether a shared target is still needed by
// another agent before deleting it.
//
// Task 6 (applyInstallPlan) consumes InstallPlan/RemovalPlan to perform the
// actual transactional filesystem writes, backups, and ManagedArtifactRecord
// persistence (artifact-state.ts). This module only computes the plan.
import path from 'path';
import { AgentTarget, ArtifactType, RendererId, Scope, providerFor, unsupportedScopeError } from '../providers';
import { renderedFilename } from './renderers/registry';
import { ManagedArtifactRecord } from './artifact-state';

export type ArtifactIntent = {
    name: string;
    installName: string;
    type: ArtifactType;
    sourcePath: string;
};

export type PlannedOperation = ManagedArtifactRecord & {
    method: 'symlink' | 'copy';
    output: RendererId;
};

export type InstallReport = {
    owner: AgentTarget;
    targetPath: string;
    action: 'install' | 'retain';
};

export type InstallPlan = {
    operations: PlannedOperation[];
    records: ManagedArtifactRecord[];
    reports: InstallReport[];
};

export type PlanInstallParams = {
    artifacts: ArtifactIntent[];
    selectedAgents: AgentTarget[];
    enabledAgents: AgentTarget[];
    scope: Scope;
    projectRoot: string;
    method: 'symlink' | 'copy';
};

export type RemovalOperation = ManagedArtifactRecord & { action: 'unlink' };

export type RemovalPlan = {
    operations: RemovalOperation[];
    records: ManagedArtifactRecord[];
};

export type PlanRemovalParams = {
    records: ManagedArtifactRecord[];
    selectedAgents: AgentTarget[];
    enabledAgents: AgentTarget[];
    artifactNames: string[];
};

/** Resolves the single physical filesystem location an intent renders to for one agent. */
/**
 * Resolves the physical target path + renderer for one artifact intent on one
 * agent (dir + filename, applying the renderer-specific extension rename for
 * `codex-agent-toml`/`cursor-mdc`/`copilot-instructions`).
 * Shared with `core/init/mutation-targets.ts`, which needs the exact same
 * dir/filename computation to enumerate paths before a real `awm init` run —
 * duplicating this logic there would let the two silently diverge.
 */
export function physicalTarget(intent: ArtifactIntent, agent: AgentTarget, scope: Scope, projectRoot: string): {
    targetPath: string;
    renderer: RendererId;
} {
    const config = providerFor(agent)[intent.type];
    if (!config) throw new Error(`${intent.type}s are not supported by ${providerFor(agent).label}`);
    const dir = scope === 'local' ? path.join(projectRoot, config.local) : config.global;
    if (dir === null) {
        throw unsupportedScopeError(intent.type, scope, providerFor(agent).label, config.globalUnsupportedReason);
    }
    // Rendered targets get a provider-specific extension in place of a
    // trailing `.md` (if any) on intent.installName, so e.g. `using-awm`
    // (skills carry no extension) or `using-awm.md` both become
    // `using-awm.instructions.md`, never `using-awm.md.instructions.md`.
    // `renderedFilename` (core/renderers/registry.ts) es la unica fuente de
    // verdad de este mapeo. Antes vivia inline aca y re-derivado a mano en tres
    // lectores mas, uno de los cuales lo omitia por completo — y ese era
    // justamente el que decidia si un artefacto estaba instalado.
    const filename = renderedFilename(intent.installName, config.renderer);
    const targetPath = path.join(dir, filename);
    // Asercion de contencion: el destino resuelto DEBE caer dentro del
    // directorio del provider. `dir` es el ancla de confianza real (sale de la
    // config del provider, no del contenido), asi que verificarlo aca atrapa
    // cualquier camino — presente o futuro — que construya un `installName` sin
    // pasar por `assertSafeArtifactName`. Los nombres llegan desde el
    // `bundle.json` de un registry, y el instalador borra el destino de forma
    // recursiva antes de enlazar: un escape aca no es un archivo mal ubicado,
    // es borrado arbitrario fuera del sandbox.
    const resolvedDir = path.resolve(dir);
    const resolved = path.resolve(targetPath);
    if (resolved !== resolvedDir && !resolved.startsWith(resolvedDir + path.sep)) {
        throw new Error(
            `refusing to install outside the target directory: ${JSON.stringify(intent.installName)} ` +
            `resolves to ${resolved}, which is not inside ${resolvedDir}`
        );
    }
    return { targetPath, renderer: config.renderer };
}

/**
 * The physical directory `agent`'s skill artifacts resolve to at `scope` —
 * independent of any specific artifact/intent, since every skill intent for
 * a given agent+scope shares the same directory and only the filename
 * inside it varies (`physicalTarget`'s `dir` component, without the
 * filename). Exposed so callers that need to answer "does agent X share
 * agent Y's skill target?" purely structurally — e.g. deciding which agents
 * to proactively include in a `selectedAgents` set — don't need to invent a
 * throwaway `ArtifactIntent` just to ask a directory-equality question.
 */
export function skillTargetDir(agent: AgentTarget, scope: Scope, projectRoot: string): string {
    const config = providerFor(agent).skill;
    if (scope === 'local') return path.join(projectRoot, config.local);
    if (config.global === null) {
        throw unsupportedScopeError('skill', scope, providerFor(agent).label, config.globalUnsupportedReason);
    }
    return config.global;
}

/**
 * Of `candidates`, the ones that share `agent`'s skill physical target at
 * `scope` (includes `agent` itself when it appears in `candidates`). Used by
 * `core/init/steps.ts` to compute the correct `selectedAgents` for an
 * automatic baseline/ambient bundle install: `stepDevCore`/`stepAmbient`
 * used to pass a `[agent]` singleton, which `assertCompleteSharedGroup`
 * below (R14) then refused whenever a co-owner (e.g. OpenCode alongside
 * Codex) was independently enabled — a BLOCKER that made `awm init --agent
 * codex` structurally fail once OpenCode was already enabled, and vice
 * versa. Passing the complete shared group up front avoids tripping R14 in
 * the first place, without weakening the assertion itself.
 */
export function agentsSharingSkillTarget(
    agent: AgentTarget,
    candidates: AgentTarget[],
    scope: Scope,
    projectRoot: string,
): AgentTarget[] {
    const target = skillTargetDir(agent, scope, projectRoot);
    return candidates.filter((candidate) => {
        // A candidate that doesn't support this scope at all (e.g. Copilot at
        // `global` — skillTargetDir throws) trivially can't share `agent`'s
        // target; it just isn't part of the group. Without this guard, a
        // Copilot in `candidates` (enabled for some OTHER, valid install) would
        // crash this whole computation for every unrelated agent, since the
        // exception surfaces from inside `.filter()`'s callback uncaught.
        try {
            return skillTargetDir(candidate, scope, projectRoot) === target;
        } catch {
            return false;
        }
    });
}

/**
 * Skills are, today, the only artifact type where two agents' provider
 * configs physically resolve to the exact same directory (OpenCode and Codex
 * both use `~/.agents/skills` globally). Because that target is shared,
 * selecting only part of the group sharing it would either strand the
 * unselected agent's install or silently delete on its behalf. Refuse the
 * whole change instead (R14): every enabled agent that shares a given
 * skill's physical target with a selected agent must itself be selected.
 */
function assertCompleteSharedGroup(
    intent: ArtifactIntent,
    selected: AgentTarget[],
    enabled: AgentTarget[],
    scope: Scope,
    projectRoot: string,
): void {
    if (intent.type !== 'skill') return;
    for (const agent of selected) {
        // El `.filter()` de abajo ya tenia esta guarda; esta linea no — y es la
        // que corre PRIMERO. Con copilot en `selected` (que es lo que hace
        // `awm update`, que apunta a todos los agentes habilitados) tiraba aca,
        // antes de llegar al loop de planificacion, rompiendo el comando para
        // TODOS los demas agentes de la maquina. Un agente que no soporta este
        // scope no tiene grupo compartido que verificar: no es parte del grupo.
        let target: string;
        try { target = physicalTarget(intent, agent, scope, projectRoot).targetPath; }
        catch { continue; }
        // Same reasoning as agentsSharingSkillTarget above: a candidate in
        // `enabled` that doesn't support this scope (e.g. Copilot at `global`)
        // can't be part of the shared-target group — it just isn't a
        // candidate, not a hard failure of this assertion. Without this
        // guard, having Copilot enabled at all would crash every OTHER
        // agent's shared-group check.
        const group = enabled.filter((candidate) => {
            try {
                return physicalTarget(intent, candidate, scope, projectRoot).targetPath === target;
            } catch {
                return false;
            }
        });
        if (group.some((candidate) => !selected.includes(candidate))) {
            throw new Error(`Shared skill target cannot diverge; select the complete shared target group: ${group.join(',')}`);
        }
    }
}

/**
 * Plans installation of `artifacts` for `selectedAgents`. Pure — no
 * filesystem access. Groups by physical location (targetPath + renderer) —
 * NOT sourcePath: a target path is one filesystem location, so at most one
 * source may back it. When two selected agents resolve an intent to the
 * identical physical location with the SAME sourcePath, they collapse into a
 * single PlannedOperation with both agents listed as owners (R15/R15.1), so
 * the operation is only ever performed once. When two intents resolve to the
 * same physical location with DIFFERENT sourcePaths (e.g. same skill name
 * shipped by two different registries), that is a genuine conflict — one
 * target can't be backed by two different sources — and planInstall throws
 * before producing any operations, in the same "abort before writes" spirit
 * as assertCompleteSharedGroup's shared-group error. Independently addressed
 * artifact types (workflow, agent) never collapse across agents, since each
 * agent's provider config points at its own directory (R12/R13). An artifact
 * type unsupported by a given agent (provider config is null for that type)
 * is silently skipped for that agent, mirroring the legacy installBundle
 * skip semantics — it is not an error.
 *
 * Within a shared group, the first owner (in selection order) is reported
 * with action 'install' (it is the one that causes the operation) and any
 * additional co-owners are reported 'retain' (the write already covers
 * them; they simply gain ownership of it).
 */
export function planInstall(params: PlanInstallParams): InstallPlan {
    const { artifacts, selectedAgents, enabledAgents, scope, projectRoot, method } = params;

    for (const intent of artifacts) {
        assertCompleteSharedGroup(intent, selectedAgents, enabledAgents, scope, projectRoot);
    }

    type Group = {
        name: string;
        type: ArtifactType;
        sourcePath: string;
        targetPath: string;
        renderer: RendererId;
        owners: AgentTarget[];
    };
    const groups = new Map<string, Group>();

    for (const intent of artifacts) {
        // Agentes que estructuralmente NO pueden recibir este artefacto en este
        // scope — hoy: copilot en scope global, que no tiene mecanismo de
        // descubrimiento de skills a nivel usuario.
        //
        // Se saltean, pero SOLO si algun otro agente seleccionado si puede. La
        // distincion es deliberada:
        //  - `awm update` / `awm add <bundle>` corren sobre TODOS los agentes
        //    habilitados. Que uno no pueda no es un error del usuario, y hacer
        //    tirar todo el plan rompia el comando para TODOS los demas agentes
        //    de la maquina — incluido el re-sync de hooks, que ni se alcanzaba.
        //  - `awm add x -a copilot -s global` es una peticion EXPLICITA. Ahi no
        //    hay a quien saltear, asi que sigue tirando con la explicacion
        //    (`globalUnsupportedReason`), que es justo lo que el usuario
        //    necesita leer.
        const capable = selectedAgents.filter((agent) => {
            if (!providerFor(agent)[intent.type]) return false;
            try { physicalTarget(intent, agent, scope, projectRoot); return true; }
            catch { return false; }
        });
        const effectiveAgents = capable.length > 0 ? capable : selectedAgents;

        for (const agent of effectiveAgents) {
            const config = providerFor(agent)[intent.type];
            if (!config) continue;
            const { targetPath, renderer } = physicalTarget(intent, agent, scope, projectRoot);
            // Key on the physical location alone (targetPath + renderer), NOT
            // sourcePath: a target path is one filesystem location, so it can
            // only ever be backed by one source. Including sourcePath in the
            // key would let two intents with different sources but the same
            // target silently produce two operations for the same physical
            // location — see the conflict check just below.
            const key = `${targetPath}\0${renderer}`;
            let group = groups.get(key);
            if (!group) {
                group = {
                    name: intent.name,
                    type: intent.type,
                    sourcePath: intent.sourcePath,
                    targetPath,
                    renderer,
                    owners: [],
                };
                groups.set(key, group);
            } else if (group.sourcePath !== intent.sourcePath) {
                throw new Error(
                    `physical target already claimed by a different source: ${targetPath} (${group.sourcePath} vs ${intent.sourcePath})`,
                );
            }
            if (!group.owners.includes(agent)) group.owners.push(agent);
        }
    }

    const operations: PlannedOperation[] = [];
    const records: ManagedArtifactRecord[] = [];
    const reports: InstallReport[] = [];

    for (const group of groups.values()) {
        const record: ManagedArtifactRecord = {
            name: group.name,
            type: group.type,
            scope,
            targetPath: group.targetPath,
            sourcePath: group.sourcePath,
            renderer: group.renderer,
            owners: group.owners,
        };
        records.push(record);
        operations.push({ ...record, method, output: group.renderer });
        group.owners.forEach((owner, index) => {
            reports.push({ owner, targetPath: group.targetPath, action: index === 0 ? 'install' : 'retain' });
        });
    }

    return { operations, records, reports };
}

/**
 * Plans removal of `artifactNames` for `selectedAgents` against the
 * currently persisted `records`. For each matching record, owners being
 * removed drop out of its owner list; if any remaining owner is still in
 * `enabledAgents`, the physical target is retained (R16) — no unlink is
 * produced, and the record is carried forward with the reduced owner list.
 * Only when no enabled owner remains does the record become an unlink
 * operation, dropping out of the returned records. Records for artifacts not
 * named in `artifactNames` pass through unchanged.
 */
export function planRemoval(params: PlanRemovalParams): RemovalPlan {
    const { records, selectedAgents, enabledAgents, artifactNames } = params;
    const operations: RemovalOperation[] = [];
    const resultRecords: ManagedArtifactRecord[] = [];

    for (const record of records) {
        if (!artifactNames.includes(record.name)) {
            resultRecords.push(record);
            continue;
        }
        const remainingOwners = record.owners.filter((owner) => !selectedAgents.includes(owner));
        const activeOwners = remainingOwners.filter((owner) => enabledAgents.includes(owner));
        if (activeOwners.length > 0) {
            resultRecords.push({ ...record, owners: remainingOwners });
        } else {
            operations.push({ ...record, owners: remainingOwners, action: 'unlink' });
        }
    }

    return { operations, records: resultRecords };
}
