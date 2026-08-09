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
import { SkillIntegrity, classifySkillLinks } from '../skill-integrity';
import { assertProviderSupported } from '../provider-version';
import { computeHookStatus } from '../../commands/hooks/status';
import { InjectionOrchestrator } from '../context/orchestrator';
import { capabilityRoot, contentRoots } from '../registries';
import { rendererExtension } from '../renderers/registry';

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
 *  `renderer` gates which verification is possible: `classifySkillLinks` (via `integrity`)
 *  only ever sees symlinks — `if (!lst.isSymbolicLink()) continue;` — so for a rendered
 *  format (`cursor-mdc`, `copilot-instructions`) it scans a directory of real files and
 *  finds nothing, which would make `broken` silently read 0 regardless of whether the
 *  rendered files are actually well-formed. Reporting `'healthy'` from a scan that
 *  structurally can't see the files it's supposed to check would be a false green, so for
 *  any non-`'link'` renderer this reports presence only, honestly, via `detail`. */
function skillsGlobalCheck(
    dir: string | null,
    owners: AgentTarget[],
    integrity: SkillIntegrity,
    renderer: RendererId,
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
        // Still not full integrity verification (a stray file with the right extension but
        // wrong content still passes) — that residual gap is the same honest tradeoff this
        // function's doc comment already accepts for the non-`'link'` branch generally.
        // `rendererExtension` (core/renderers/registry.ts) is the ONE table mapping a
        // renderer to the file it produces. This site used to keep its own partial copy —
        // the fourth such copy in the codebase, and the exact drift that made a rendered
        // artifact invisible to the "is it installed" check for a whole release. A new
        // renderer must not be able to be added without this reading it.
        const ext = rendererExtension(renderer);
        const present = ext ? entries.some((e) => e.endsWith(ext)) : entries.length > 0;
        return {
            id: 'skills.global',
            state: present ? 'supported' : 'absent',
            target: dir,
            owners: owners.length > 1 ? owners : undefined,
            detail: present ? 'rendered install — content integrity not verified' : undefined,
            remediationCode: present ? undefined : 'awm-init',
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

/** R8: verify the Codex `.toml` agents this run's renderer would have produced still parse. */
function tomlAgentsHealthy(dir: string, entries: string[]): { broken: number } {
    const tomls = entries.filter((e) => e.endsWith('.toml'));
    const broken = tomls.filter((file) => {
        try {
            const content = fs.readFileSync(path.join(dir, file), 'utf8');
            // renderCodexAgent (Task 4) always emits this key — its absence means the
            // file was hand-edited or truncated, not a shape `awm` would have written.
            return !content.includes('developer_instructions = ');
        } catch {
            return true;
        }
    }).length;
    return { broken };
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
    const integrity = classifySkillLinks(dir, contentRoots());
    const broken = integrity.repairable.length + integrity.dead.length;
    return {
        id: 'workflows.global',
        state: broken > 0 ? 'broken' : 'healthy',
        target: dir,
        detail: broken > 0 ? `${broken} broken link(s)` : undefined,
        remediationCode: broken > 0 ? 'awm-init' : undefined,
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
        const { broken } = tomlAgentsHealthy(dir, entries);
        return {
            id: 'agents.native',
            state: broken > 0 ? 'broken' : 'healthy',
            target: dir,
            detail: broken > 0 ? `${broken} malformed .toml` : undefined,
            remediationCode: broken > 0 ? 'reinstall-native-agents' : undefined,
        };
    }
    return { id: 'agents.native', state: 'healthy', target: dir };
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

    return agents.map((agent) => {
        const provider = providerFor(agent);
        const dir = provider.skill.global;
        const owners = (dir !== null ? ownersByDir.get(dir) : undefined) ?? [agent];
        const integrity = (dir !== null ? scansByDir.get(dir) : undefined)
            ?? { valid: [], repairable: [], dead: [], usurped: [] };

        const checks: ProviderCheck[] = [
            binaryVersionCheck(agent),
            skillsGlobalCheck(dir, owners, integrity, provider.skill.renderer),
            agentsNativeCheck(agent),
            workflowsGlobalCheck(agent),
            hookTrustCheck(agent),
            contextGlobalCheck(agent, projectRoot),
        ].filter((check): check is ProviderCheck => check !== null);

        return { id: agent, label: provider.label, tier: providerTier(provider), checks };
    });
}
