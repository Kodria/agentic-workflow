// src/core/diagnostics/provider-checks.ts
//
// Builds the per-provider diagnostic matrix consumed by `awm doctor`
// (Task 9). Kept in its own module (rather than growing context.ts or
// checks.ts) because it has a distinct concern: turning raw provider state
// (binary version, skill/agent dirs, hook trust, context injection) into a
// small set of stable, JSON-friendly `ProviderCheck` rows — one per
// provider, deduplicated for physical directories shared between providers
// (today: OpenCode and Codex both read/write ~/.agents/skills).
import fs from 'fs';
import path from 'path';
import { AgentTarget, ProviderConfig, RendererId, Scope, providerFor } from '../../providers';
import { ProviderCheck, ProviderCheckState, ProviderFacts, ProviderTier } from './types';
import { SkillIntegrity, classifySkillLinks, managedLinkTargets } from '../skill-integrity';
import { ManagedArtifactRecord, readArtifactState } from '../artifact-state';
import { assertProviderSupported } from '../provider-version';
import { computeHookStatus } from '../../commands/hooks/status';
import { InjectionOrchestrator } from '../context/orchestrator';
import { capabilityRoot, contentRoots } from '../registries';
import { rendererExtension, rendererIntegrityMarker, renderArtifact } from '../renderers/registry';

export type ScanSkills = (dir: string) => SkillIntegrity;

/** Structural classification, computed purely from `provider`'s config shape — see
 *  `ProviderTier`'s doc comment in `types.ts` for what each tier means. */
export function providerTier(provider: ProviderConfig): ProviderTier {
    if (provider.hooks) return 'hooks-native';
    if (provider.injection?.type === 'config-instructions') return 'config-managed';
    if (provider.injection) return 'agents-md-managed';
    return 'context-only';
}

function binaryVersionCheck(agent: AgentTarget): ProviderCheck {
    const provider = providerFor(agent);
    if (!provider.versionCommand || !provider.minimumVersion) {
        // No version gate for this agent — nothing to enforce, treat as supported.
        return { id: 'binary.version', state: 'supported' };
    }
    try {
        const { version } = assertProviderSupported(agent);
        return { id: 'binary.version', state: 'supported', target: version ?? undefined };
    } catch (err) {
        const message = (err as Error).message;
        const missing = /not installed|not available on PATH/i.test(message);
        return {
            id: 'binary.version',
            state: missing ? 'missing' : 'unsupported',
            detail: message,
            remediationCode: missing ? 'install-provider-binary' : 'upgrade-provider-binary',
        };
    }
}

/** Returns `null` (dropped, same convention as `agentsNativeCheck`/`hookTrustCheck`) when
 *  `dir` is null — i.e. the provider has no global skill discovery mechanism at all
 *  (today: Copilot, see `globalUnsupportedReason` in providers/index.ts).
 *
 *  `renderer` parte la verificacion en dos caminos distintos porque los artefactos son
 *  distintos: `classifySkillLinks` solo ve symlinks — `if (!lst.isSymbolicLink()) continue;`
 *  — asi que sobre un directorio de archivos renderizados no encuentra nada. Durante un
 *  tiempo esa rama reporto SOLO presencia, y lo decia en el `detail` para no fingir una
 *  verificacion que no ocurria. Ahora tambien comprueba contenido, con el marcador que
 *  declara el renderer (`rendererIntegrityMarker`): un archivo con la extension correcta
 *  y el cuerpo vacio o truncado ya no pasa como sano. */
function skillsGlobalCheck(
    dir: string | null,
    owners: AgentTarget[],
    integrity: SkillIntegrity,
    renderer: RendererId,
    artifacts: ManagedArtifactRecord[],
): ProviderCheck | null {
    if (dir === null) return null;
    if (renderer !== 'link') {
        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch {
            // best-effort: any readdirSync failure (absent dir, EACCES, …) reads the
            // same as "nothing installed" here — a permissions error surfacing as
            // `remediationCode: 'awm-init'` is a worse remedy than none, but this
            // check has no channel to report "can't tell" separately from "absent"
            // (same tradeoff already made by this file's agentsNativeCheck and by
            // skill-integrity.ts's classifySkillLinks — a systemic, pre-existing
            // pattern in this codebase, not introduced here).
            entries = [];
        }
        // Require at least one entry with the extension this renderer actually produces,
        // not just ANY file — a directory non-empty only because of the user's own
        // pre-existing, unrelated rule/instructions file must not read as "AWM installed".
        // `rendererExtension` (core/renderers/registry.ts) is the ONE table mapping a
        // renderer to the file it produces. This site used to keep its own partial copy —
        // the fourth such copy in the codebase, and the exact drift that made a rendered
        // artifact invisible to the "is it installed" check for a whole release. A new
        // renderer must not be able to be added without this reading it.
        const ext = rendererExtension(renderer);
        const rendered = ext ? entries.filter((e) => e.endsWith(ext)) : entries;
        const present = rendered.length > 0;
        if (!present) {
            return {
                id: 'skills.global', state: 'absent', target: dir,
                owners: owners.length > 1 ? owners : undefined,
                remediationCode: 'awm-init',
            };
        }
        // Ya no se reporta "content integrity not verified": AHORA se verifica.
        // Comprobar presencia y extension dejaba pasar un archivo correcto por fuera y
        // vacio o truncado por dentro — el agente cargaba nada y doctor decia que si.
        const corrupt = corruptRendered(dir, rendered, renderer);
        if (corrupt.length > 0) {
            return {
                id: 'skills.global', state: 'broken', target: dir,
                owners: owners.length > 1 ? owners : undefined,
                detail: `${corrupt.length} rendered file(s) missing their expected content (${corrupt.slice(0, 3).join(', ')})`,
                // Codigo propio: no es una usurpacion (nadie lo reemplazo por otra cosa) ni
                // un symlink colgante. Es nuestro archivo, con el contenido incompleto — lo
                // arregla re-instalar el bundle, que lo reescribe.
                remediationCode: 'reinstall-rendered-artifacts',
            };
        }
        // Frescura, DESPUES de integridad: un archivo truncado tambien difiere de su
        // fuente, y "incompleto" es mas util que "viejo". Solo aplica a renderizados — un
        // symlink apunta al registry, asi que `awm update` lo actualiza solo. Los
        // generados NO: quedan con el contenido de la version anterior hasta que alguien
        // corra `awm sync`, y hasta ahora nada lo decia.
        const stale = staleRendered(dir, artifacts);
        const names = stale.map((r) => path.basename(r.targetPath));
        return {
            id: 'skills.global',
            state: stale.length > 0 ? 'stale' : 'supported',
            target: dir,
            owners: owners.length > 1 ? owners : undefined,
            detail: stale.length > 0
                ? `${stale.length} rendered file(s) no longer match the installed registry (${names.slice(0, 3).join(', ')})`
                : undefined,
            // El remedio depende del ALCANCE, y se midio cual funciona en cada uno:
            // `awm update` reconcilia los artefactos de maquina, `awm sync` los que el
            // profile del proyecto declara. Ofrecer el equivocado seria mandar al usuario
            // a un comando que corre limpio sin cambiar nada — el defecto que ya tuvo
            // `open-hooks-trust` (D-010), y que la primera version de ESTE chequeo
            // repitio: ofrecia `reinstall-bundle` porque dos mediciones mias estaban mal.
            remediationCode: stale.length > 0
                ? (stale.some((r) => r.scope === 'local') ? 'awm-sync' : 'awm-update')
                : undefined,
        };
    }
    const shared = owners.length > 1;
    const broken = integrity.repairable.length + integrity.dead.length;
    // Usurpado ≠ roto: el link no cuelga, DESAPARECIO — otro instalador dejo un
    // directorio real con el mismo nombre encima. El agente carga esa skill, no la
    // nuestra, y hasta que esto se reporto el scan solo miraba symlinks, asi que el
    // caso era literalmente invisible y `overall` decia `healthy`. No se auto-repara:
    // borrar un directorio real con contenido de un tercero es destructivo y necesita
    // que lo pida una persona.
    const usurped = integrity.usurped.length;
    // Broken links are checked BEFORE shared: 'shared' is a non-degrading/OK state
    // (see checks.ts's DEGRADING_PROVIDER_STATES), so if it were set unconditionally
    // for a shared dir it would silently mask real broken/dead symlinks — a green
    // checkmark next to "N broken links → repair-global-skills" would contradict its
    // own trailing text, and `overall` would never degrade despite real breakage.
    let state: ProviderCheckState;
    if (broken > 0 || usurped > 0) {
        state = 'broken';
    } else if (shared) {
        state = 'shared';
    } else if (!fs.existsSync(dir)) {
        state = 'absent';
    } else {
        state = 'healthy';
    }
    return {
        id: 'skills.global',
        state,
        target: dir,
        owners: shared ? owners : undefined,
        detail: [
            broken > 0 ? `${broken} broken links` : null,
            usurped > 0
                ? `${usurped} replaced by non-AWM content (${integrity.usurped.join(', ')})`
                : null,
        ].filter(Boolean).join('; ') || undefined,
        // Una usurpacion NO la arregla `repair-global-skills` (solo toca symlinks
        // colgantes), asi que ofrecer ese remedio seria mandar al usuario a un comando
        // que no cambia nada. Reinstalar el bundle es lo que la resuelve.
        remediationCode: usurped > 0
            ? 'reinstall-usurped-skills'
            : broken > 0 ? 'repair-global-skills' : undefined,
    };
}

/**
 * Archivos renderizados cuyo contenido ya no es lo que el renderer escribe.
 *
 * El marcador sale de `rendererIntegrityMarker` — la MISMA tabla que da la extension —
 * y no de una copia local. Antes solo `codex-agent-toml` tenia esta verificacion, con su
 * marcador horneado en esta funcion: el tercer renderer en agregarse habria pasado sin
 * verificar y nadie se habria enterado.
 *
 * Un archivo ilegible cuenta como corrupto: no poder leerlo no es evidencia de que este
 * bien. Es la misma disciplina que el resto de los checks — nunca verde por no mirar.
 */
function staleRendered(dir: string, records: ManagedArtifactRecord[]): ManagedArtifactRecord[] {
    return records
        .filter((r) => r.renderer !== 'link' && path.dirname(r.targetPath) === dir)
        .filter((r) => {
            try {
                const expected = renderArtifact(r.renderer, r.sourcePath);
                if (expected === null) return false;
                return fs.readFileSync(r.targetPath, 'utf8') !== expected;
            } catch {
                // Fuente ausente (el registry ya no la trae) o target ilegible: no es
                // desactualizacion, es otra cosa, y la reportan los checks que
                // corresponden. Aca "no puedo comparar" no se convierte en "esta viejo".
                return false;
            }
        });
}

function corruptRendered(dir: string, files: string[], renderer: RendererId): string[] {
    const marker = rendererIntegrityMarker(renderer);
    if (marker === null) return [];
    return files.filter((file) => {
        try {
            return !fs.readFileSync(path.join(dir, file), 'utf8').includes(marker);
        } catch {
            return true;
        }
    });
}


/**
 * Returns `null` when a check doesn't structurally apply to `agent` (e.g. Antigravity
 * has no `agent`/`hooks`/`injection` config; OpenCode has no hooks; Claude Code's global
 * context rides its SessionStart hook, already covered by hook.trust). `null` rows are
 * dropped by `gatherProviderChecks` — omitted entirely, not rendered as a failure. This
 * is deliberately distinct from `state: 'unsupported'`, which `binaryVersionCheck` still
 * uses for a genuine failure (an installed CLI version below the required minimum) — that
 * state correctly degrades `overall` (see checks.ts's DEGRADING_PROVIDER_STATES) and must
 * never be reused to mean "not applicable", or a fully-healthy single-provider `awm doctor`
 * run (e.g. claude-code-only, opencode-only, antigravity-only) would always render
 * inapplicable rows as red ✖ and `overall` could never be 'healthy'.
 */
/**
 * Workflows installed at machine scope. Today only Antigravity declares a `workflow`
 * config at all (`~/.gemini/antigravity/global_workflows`), and nothing verified it:
 * `awm init` installed the baseline's workflows there and every diagnostic looked only
 * at skills and native agents, so a broken or emptied workflow directory reported
 * `healthy` forever on the one provider that uses it.
 *
 * Same N/A discipline as `agentsNativeCheck`: a provider with no workflow config, or a
 * registry that ships no `workflows/`, emits NO row rather than a red one nobody can
 * act on — an absent row means "nothing to verify", not "verified fine".
 */
function workflowsGlobalCheck(agent: AgentTarget): ProviderCheck | null {
    const provider = providerFor(agent);
    if (!provider.workflow || provider.workflow.global === null) return null;

    const dir = provider.workflow.global;
    let entries: string[];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return null;
    }
    if (entries.length === 0) return null;

    // Los workflows se instalan con el renderer `link`, asi que un symlink colgante es
    // exactamente la misma clase de rotura que en skills — y se clasifica con la misma
    // funcion, no con una copia local que pueda divergir.
    //
    // El ledger va SIEMPRE que se escanee un dir gestionado. Cuando se agrego la
    // deteccion de usurpaciones (D-007) se cableo en el seam `scanSkills`, que alimenta
    // `skills.global` — y este sitio, que llama al clasificador directo, quedo afuera:
    // detectaba links colgantes y no un workflow reemplazado por contenido ajeno. Es el
    // mismo hermano-sin-tratar que ya aparecio varias veces en este archivo.
    const integrity = classifySkillLinks(dir, contentRoots(), managedLinkTargets(safeArtifactState()));
    const broken = integrity.repairable.length + integrity.dead.length;
    const usurped = integrity.usurped.length;
    return {
        id: 'workflows.global',
        state: broken > 0 || usurped > 0 ? 'broken' : 'healthy',
        target: dir,
        detail: [
            broken > 0 ? `${broken} broken link(s)` : null,
            usurped > 0 ? `${usurped} replaced by non-AWM content (${integrity.usurped.join(', ')})` : null,
        ].filter(Boolean).join('; ') || undefined,
        remediationCode: usurped > 0 ? 'reinstall-usurped-skills' : broken > 0 ? 'awm-init' : undefined,
    };
}

function agentsNativeCheck(agent: AgentTarget): ProviderCheck | null {
    const provider = providerFor(agent);
    if (!provider.agent || provider.agent.global === null) return null;

    const dir = provider.agent.global;
    let entries: string[];
    // `absent` degrada el estado global, asi que sin `remediationCode` doctor
    // salia 1 sin decir que hacer — y para un registry que simplemente no trae
    // `agents/` (lo normal) ese rojo no tiene accion posible. Se reporta como
    // `unsupported`, que describe la realidad: no hay artefactos nativos que
    // verificar, y no es culpa de la instalacion.
    // Un registry que simplemente no trae `agents/` es lo normal, no un defecto
    // de la instalacion — y no hay accion que el usuario pueda tomar. Antes esto
    // devolvia `absent`, un estado que DEGRADA, y sin `remediationCode`: doctor
    // salia 1 mostrando `✖ native agents` sin decir que hacer, justo despues de
    // un `awm init` exitoso. Cuando no hay nada nativo que verificar, no se
    // emite fila — el mismo criterio que ya usan los demas casos N/A de aca.
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return null;
    }
    if (entries.length === 0) return null;

    if (provider.agent.renderer === 'codex-agent-toml') {
        // La extension sale de la tabla, no de un literal: escribir '.toml' aca fue
        // exactamente lo que el guard estructural existe para detener, y lo detuvo.
        const tomlExt = rendererExtension('codex-agent-toml') as string;
        const broken = corruptRendered(dir, entries.filter((e) => e.endsWith(tomlExt)), 'codex-agent-toml').length;
        return {
            id: 'agents.native',
            state: broken > 0 ? 'broken' : 'healthy',
            target: dir,
            detail: broken > 0 ? `${broken} malformed .toml` : undefined,
            remediationCode: broken > 0 ? 'reinstall-native-agents' : undefined,
        };
    }
    // Renderer `link` (claude-code, `~/.claude/agents`): esto devolvia `healthy` fijo
    // con solo mirar que el dir no estuviera vacio. Un symlink colgante ahi adentro
    // pasaba, y un artefacto reemplazado por contenido de un tercero tambien — el
    // agente cargaba el ajeno mientras doctor daba verde. El dir es gestionado igual
    // que el de skills, asi que se verifica igual.
    const integrity = classifySkillLinks(dir, contentRoots(), managedLinkTargets(safeArtifactState()));
    const broken = integrity.repairable.length + integrity.dead.length;
    const usurped = integrity.usurped.length;
    return {
        id: 'agents.native',
        state: broken > 0 || usurped > 0 ? 'broken' : 'healthy',
        target: dir,
        detail: [
            broken > 0 ? `${broken} broken link(s)` : null,
            usurped > 0 ? `${usurped} replaced by non-AWM content (${integrity.usurped.join(', ')})` : null,
        ].filter(Boolean).join('; ') || undefined,
        remediationCode: usurped > 0 ? 'reinstall-usurped-skills' : broken > 0 ? 'reinstall-native-agents' : undefined,
    };
}

/** El ledger de propiedad, best-effort: un archivo ausente o corrupto degrada a "no
 *  puedo detectar usurpaciones", nunca revienta un comando de diagnostico. Mismo
 *  criterio que `safeReadArtifactState` en context.ts. */
function safeArtifactState(): ManagedArtifactRecord[] {
    try { return readArtifactState(); } catch { return []; }
}

function hookTrustCheck(agent: AgentTarget): ProviderCheck | null {
    const provider = providerFor(agent);
    if (!provider.hooks) return null;

    let status;
    try {
        status = computeHookStatus(agent);
    } catch {
        return { id: 'hook.trust', state: 'absent', remediationCode: 'awm-init' };
    }
    if (status.overall === 'NOT_INSTALLED') {
        return { id: 'hook.trust', state: 'absent', remediationCode: 'awm-init' };
    }
    if (status.trust) {
        // Codex: 'pending-trust' | 'healthy' | 'stale' map directly onto ProviderCheckState.
        return {
            id: 'hook.trust',
            state: status.trust,
            remediationCode: status.trust === 'pending-trust' ? 'open-hooks-trust' : undefined,
        };
    }
    return { id: 'hook.trust', state: status.overall === 'HEALTHY' ? 'healthy' : 'broken' };
}

/** R7: reflects the provider's global context-delivery mechanism (config-instructions /
 *  managed-agents-md). claude-code's context rides the SessionStart hook — already
 *  covered by hook.trust, so this check is OMITTED (returns null) rather than reported,
 *  to avoid double-reporting the same fact as a separate, redundant row.
 *
 *  Scope mirrors `init/steps.ts`'s `stepContextInjection` exactly: a `managed-agents-md`
 *  provider with `globalPath === null` (today: Cursor, Copilot) has no user-level
 *  AGENTS.md-equivalent file, so its context is legitimately delivered at LOCAL (project)
 *  scope instead — asking `contextStatus` about 'global' for these providers always
 *  resolved to 'absent' regardless of whether the local injection actually succeeded. The
 *  check's `id` stays `'context.global'` either way (stable JSON field); only the
 *  underlying scope resolution changes. `projectRoot` is only meaningful when the resolved
 *  scope is 'local' — if it's needed but missing, `contextStatus` throws cleanly
 *  (`InjectionOrchestrator`'s `contextPathFor`) and the catch below falls back to 'absent',
 *  same as any other failure to resolve status. */
function contextGlobalCheck(agent: AgentTarget, projectRoot?: string): ProviderCheck | null {
    const injection = providerFor(agent).injection;
    if (!injection || injection.type === 'cc-settings-merge') {
        return null;
    }
    const scope: Scope = injection.type === 'managed-agents-md' && injection.globalPath === null ? 'local' : 'global';
    let state: ProviderCheckState = 'absent';
    try {
        const orchestrator = new InjectionOrchestrator();
        const result = orchestrator.contextStatus({
            agent,
            scope,
            registryRoot: capabilityRoot('skills') ?? '',
            installMethod: 'symlink',
            profileExtensions: [],
            projectRoot,
        });
        state = result === 'injected' ? 'delivered' : result === 'stale' ? 'stale' : 'absent';
    } catch {
        state = 'absent';
    }
    return {
        id: 'context.global',
        state,
        remediationCode: state === 'delivered' ? undefined : 'awm-init',
    };
}

/**
 * Builds one `ProviderFacts` row per requested agent. Physical skill directories shared
 * between providers (OpenCode + Codex both use `~/.agents/skills`) are scanned exactly
 * once via `scanSkills` and every owner's `skills.global` check is marked `state: 'shared'`
 * — mirrors the dedup principle `install-planner.ts` (Task 5) already applies to writes.
 *
 * Named `gatherProviderChecks` (not `gatherProviderFacts`) to avoid colliding with the
 * unrelated `gatherProviderFacts` in `core/init/provider-facts.ts` (Task 8, baseline-hash
 * snapshot for rollback comparison — a different shape, a different purpose). No file
 * currently imports both, but the names are close enough to trip up a future reader/editor.
 */
export function gatherProviderChecks(agents: AgentTarget[], scanSkills: ScanSkills, projectRoot?: string): ProviderFacts[] {
    const ownersByDir = new Map<string, AgentTarget[]>();
    for (const agent of agents) {
        const dir = providerFor(agent).skill.global;
        if (dir === null) continue;
        const owners = ownersByDir.get(dir) ?? [];
        owners.push(agent);
        ownersByDir.set(dir, owners);
    }

    const scansByDir = new Map<string, SkillIntegrity>();
    for (const dir of ownersByDir.keys()) {
        scansByDir.set(dir, scanSkills(dir));
    }

    // El ledger se lee UNA vez por corrida y se comparte: es la unica forma de saber
    // que fuente produjo cada artefacto renderizado, y por lo tanto de preguntar si
    // sigue coincidiendo con ella.
    const artifacts = safeArtifactState();

    return agents.map((agent) => {
        const provider = providerFor(agent);
        const dir = provider.skill.global;
        const owners = (dir !== null ? ownersByDir.get(dir) : undefined) ?? [agent];
        const integrity = (dir !== null ? scansByDir.get(dir) : undefined)
            ?? { valid: [], repairable: [], dead: [], usurped: [] };

        const checks: ProviderCheck[] = [
            binaryVersionCheck(agent),
            skillsGlobalCheck(dir, owners, integrity, provider.skill.renderer, artifacts),
            agentsNativeCheck(agent),
            workflowsGlobalCheck(agent),
            hookTrustCheck(agent),
            contextGlobalCheck(agent, projectRoot),
        ].filter((check): check is ProviderCheck => check !== null);

        return { id: agent, label: provider.label, tier: providerTier(provider), checks };
    });
}
