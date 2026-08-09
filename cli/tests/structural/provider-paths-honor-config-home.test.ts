// Un proveedor que declara override de home tiene que respetarlo en TODAS sus rutas.
//
// El caso que lo motivo: en una maquina con `CODEX_HOME` apuntando fuera del home, AWM
// instalaba el hook en `~/.codex/hooks.json` mientras Codex leia
// `$CODEX_HOME/hooks.json`. Instalacion correcta, en el archivo que nadie mira — el hook
// quedaba mudo, y `doctor` lo reportaba presente porque miraba el mismo lugar equivocado
// donde lo habia escrito. Tres rutas afectadas (`hooks.json`, `agents/`, `AGENTS.md`), y
// arreglar una o dos habria dejado el bug vivo en la tercera.
//
// Por eso el guard es una PROPIEDAD sobre la tabla entera y no una lista de rutas: no se
// puede satisfacer arreglando un sitio, y un proveedor nuevo lo hereda sin que nadie se
// acuerde de agregarlo. Ver docs/decisions.md D-011.
import path from 'path';
import { AGENT_TARGETS, AgentTarget, ProviderConfig, providers } from '../../src/providers';

/** Toda ruta absoluta que la config de un proveedor declara, con su nombre de campo. */
function absolutePaths(config: ProviderConfig): { field: string; value: string }[] {
    const out: { field: string; value: string }[] = [];
    const push = (field: string, value: string | null | undefined) => {
        if (typeof value === 'string' && path.isAbsolute(value)) out.push({ field, value });
    };
    push('skill.global', config.skill.global);
    push('workflow.global', config.workflow?.global);
    push('agent.global', config.agent?.global);
    push('hooks.settingsPath', config.hooks?.settingsPath);
    if (config.injection?.type === 'config-instructions') push('injection.configPath', config.injection.configPath);
    if (config.injection?.type === 'managed-agents-md') push('injection.globalPath', config.injection.globalPath);
    return out;
}

/** Vuelve a pedir la tabla con `env` aplicado. `providers()` la reconstruye en cada
 *  llamada leyendo el entorno, asi que no hace falta resetear modulos. */
function providersWith(env: Record<string, string | undefined>): Record<AgentTarget, ProviderConfig> {
    const previous: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) {
        previous[k] = process.env[k];
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    try {
        return providers();
    } finally {
        for (const [k, v] of Object.entries(previous)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
    }
}

const HOME = path.join(path.sep, 'tmp', 'awm-guard-home');
const ELSEWHERE = path.join(path.sep, 'tmp', 'awm-guard-elsewhere');

describe('a provider that declares a config-home override honors it everywhere', () => {
    for (const agent of AGENT_TARGETS) {
        const declared = providersWith({ HOME })[agent].configHome;
        if (!declared.envVar) continue;

        it(`${agent}: setting ${declared.envVar} moves every path that lives under its own dir`, () => {
            const base = providersWith({ HOME, [declared.envVar!]: undefined })[agent];
            const moved = providersWith({ HOME, [declared.envVar!]: ELSEWHERE })[agent];

            const defaultRoot = path.join(HOME, declared.dir);
            const under = absolutePaths(base).filter((p) => p.value.startsWith(defaultRoot));

            // Si esto diera 0, el test pasaria sin verificar nada — y ese es exactamente
            // el modo de falla que hace inutil a un guard.
            expect(under.length).toBeGreaterThan(0);

            const movedByField = new Map(absolutePaths(moved).map((p) => [p.field, p.value]));
            const stragglers = under.filter((p) => !movedByField.get(p.field)?.startsWith(ELSEWHERE));

            expect(stragglers.map((p) => `${p.field} = ${movedByField.get(p.field)}`)).toEqual([]);
        });

        it(`${agent}: an empty or blank ${declared.envVar} falls back to the default, it does not resolve to nothing`, () => {
            // Una variable exportada vacia es comun en scripts (`export CODEX_HOME=`) y
            // tomarla al pie de la letra dejaria las rutas colgando de la raiz.
            for (const blank of ['', '   ']) {
                const cfg = providersWith({ HOME, [declared.envVar!]: blank })[agent];
                expect(cfg.configHome.resolved).toBe(path.join(HOME, declared.dir));
            }
        });
    }

    it('shared, cross-agent conventions are NOT moved by one agent’s override', () => {
        // `~/.agents/skills` lo comparten Codex y OpenCode: es del ecosistema, no de un
        // agente. Moverlo con CODEX_HOME desconectaria a OpenCode de sus propias skills.
        const moved = providersWith({ HOME, CODEX_HOME: ELSEWHERE });
        expect(moved.codex.skill.global).toBe(path.join(HOME, '.agents/skills'));
        expect(moved.opencode.skill.global).toBe(path.join(HOME, '.agents/skills'));
    });

    it('every agent declares a config home, so a new provider cannot skip the question', () => {
        const table = providersWith({ HOME });
        for (const agent of AGENT_TARGETS) {
            expect(typeof table[agent].configHome.dir).toBe('string');
            expect(table[agent].configHome.dir.length).toBeGreaterThan(0);
        }
    });
});
