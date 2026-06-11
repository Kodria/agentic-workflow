// W3 — Regeneración del contexto global tras `awm update`.
// Para cada agente con inyección config-instructions cuya config exista:
//   - 'stale'    (sentinel presente, archivo materializado ausente/viejo) → re-materializa.
//   - 'injected' (ya fresco)                                              → no toca nada.
//   - 'absent'   (sentinel ausente)                                       → no inyecta (eso es `awm init`).
// Solo scope global. Defensivo: nunca rompe `awm update` por una falla de un agente.
import fs from 'fs';
import { PROVIDERS, AgentTarget } from '../../providers';
import { capabilityRoot } from '../registries';
import { InjectionOrchestrator, ContextOp } from './orchestrator';

export type RegenAction = 'refreshed' | 'fresh' | 'skipped';
export type RegenResult = { agent: AgentTarget; action: RegenAction };

export function regenerateGlobalContext(
    orch: InjectionOrchestrator = new InjectionOrchestrator(),
): RegenResult[] {
    const skillsRoot = capabilityRoot('skills');
    if (!skillsRoot) return [];

    const out: RegenResult[] = [];
    for (const agent of Object.keys(PROVIDERS) as AgentTarget[]) {
        const inj = PROVIDERS[agent].injection;
        if (!inj || inj.type !== 'config-instructions') continue;
        if (!fs.existsSync(inj.configPath)) continue;

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
