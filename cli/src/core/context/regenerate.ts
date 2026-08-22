// W3 — Regeneración del contexto global tras `awm update`.
// Para cada agente con un mecanismo de inyección aplicable:
//   - 'stale'    (sentinel presente, archivo materializado ausente/viejo) → re-materializa.
//   - 'injected' (ya fresco)                                              → no toca nada.
//   - 'absent'   (sentinel ausente)                                       → no inyecta (eso es `awm init`).
// Solo scope global. Defensivo: nunca rompe `awm update` por una falla de un agente.
import fs from 'fs';
import { AGENT_TARGETS, AgentTarget, providerFor } from '../../providers';
import { capabilityRoot } from '../registries';
import { collectDeclaredOrchestrators } from '../orchestrators';
import { InjectionOrchestrator, ContextOp } from './orchestrator';

export type RegenAction = 'refreshed' | 'fresh' | 'skipped';
export type RegenResult = { agent: AgentTarget; action: RegenAction };

export function regenerateGlobalContext(
    targets: AgentTarget[] = [...AGENT_TARGETS],
    orch: InjectionOrchestrator = new InjectionOrchestrator(),
): RegenResult[] {
    const skillsRoot = capabilityRoot('skills');
    if (!skillsRoot) return [];

    // Print each declared-orchestrator diagnostic ONCE up front, rather than letting
    // every agent's contextStatus/installContext call independently re-collect and
    // re-warn via InjectionOrchestrator.inputFor/statusInputFor (both call
    // orchestrators.ts's collectAndWarn() internally, unaware of this outer loop). A
    // single `awm update` touching N agents (e.g. opencode + codex) would otherwise
    // print the same diagnostic up to 2x per agent (once from statusInputFor, once
    // from inputFor when stale) — noisy but not incorrect, since no data is lost or
    // wrong. This only reduces the printing done BY THIS FUNCTION to one line per
    // diagnostic; inputFor/statusInputFor still call collectAndWarn() internally per
    // op (they need the declared list to build/hash context), so a per-agent
    // duplicate can still print alongside this upfront one. Deeper dedup would mean
    // threading a pre-collected list through ContextOp/InjectionOrchestrator, which
    // touches shared collection-scope logic other callers (hooks/claude.ts) rely on —
    // out of proportion for this minor finding.
    for (const d of collectDeclaredOrchestrators().diagnostics) console.warn(`warning: ${d}`);

    const out: RegenResult[] = [];
    for (const agent of targets) {
        const inj = providerFor(agent).injection;
        if (!inj) continue;
        // Antes esto exigia `type === 'config-instructions'`, o sea que SOLO se
        // regeneraba OpenCode: para codex, cursor y copilot (`managed-agents-md`)
        // `awm update` era un no-op silencioso — ni un aviso — y el unico modo
        // de refrescar su contexto era volver a correr `awm init`. Peor: doctor
        // marcaba ⚠ pero seguia reportando `status: healthy` / exit 0, asi que
        // un AGENTS.md desactualizado era invisible para cualquier gate de CI
        // que mirara el codigo de salida.
        //
        // El destino global de `managed-agents-md` puede ser null (cursor y
        // copilot no tienen archivo de contexto global); ahi no hay nada global
        // que regenerar y se saltea limpio.
        if (inj.type === 'config-instructions') {
            if (!fs.existsSync(inj.configPath)) continue;
        } else if (inj.type === 'managed-agents-md') {
            if (inj.globalPath === null) continue;
        } else if (inj.type === 'cc-settings-merge') {
            // Claude Code no pasa por este dispatcher generico: su contexto se
            // materializa via el hook dedicado (hooks/claude.ts's installClaudeHook/
            // resyncClaudeHookFiles), invocado por `awm update` a traves de un path
            // separado (hooks/resync.ts's resyncInstalledHooks). Mismo salteo que
            // stepContextInjection (init/steps.ts) y contextGlobalCheck
            // (diagnostics/provider-checks.ts) — "covered by hook". Sin este
            // continue, orch.contextStatus/installContext corrian igual para
            // claude-code y escribian un ~/.awm/context/awm-context.md huerfano que
            // nadie lee (el archivo real vive en el scriptsDir del hook).
            continue;
        }

        const op: ContextOp = {
            agent,
            scope: 'global',
            registryRoot: skillsRoot,
            installMethod: 'symlink', // config-instructions strategy ignores this; consistent with stepContextInjection/gatherContextInjection
            profileExtensions: [],
        };

        let state;
        try {
            state = orch.contextStatus(op);
        } catch {
            out.push({ agent, action: 'skipped' });
            continue;
        }

        if (state === 'injected') { out.push({ agent, action: 'fresh' }); continue; }
        if (state === 'absent') { out.push({ agent, action: 'skipped' }); continue; }

        // state === 'stale'
        try {
            orch.installContext(op);
            out.push({ agent, action: 'refreshed' });
        } catch {
            out.push({ agent, action: 'skipped' });
        }
    }
    return out;
}
