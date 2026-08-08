// Generador de la matriz de soporte que vive en `docs/support-matrix.md`.
//
// Existe porque la tabla escrita a mano ya mintio: decia que Antigravity instalaba en
// `~/.agents/skills` y `.agents/skills` cuando el codigo dice `~/.gemini/antigravity/skills`
// y `.agent/skills` (singular), y omitia que es el unico provider con `global_workflows`.
// Una tabla de soporte que no coincide con el codigo es peor que no tenerla: se cita en
// una presentacion, se planifica encima, y nadie la vuelve a chequear.
//
// El bloque generado esta delimitado por marcadores en el .md, y
// `tests/structural/support-matrix-is-current.test.ts` regenera y compara — asi que un
// cambio en `providers/index.ts` que no se refleje en el doc pone la CI en rojo. La
// verificabilidad no depende de que alguien se acuerde.
import path from 'path';
import { AGENT_TARGETS, providers, type ProviderConfig, type AgentTarget } from '../src/providers';
import { homeDir } from '../src/core/paths';

export const BEGIN_MARKER = '<!-- BEGIN GENERATED: provider-capabilities -->';
export const END_MARKER = '<!-- END GENERATED: provider-capabilities -->';

/** Cualquier separador → `/`. Las rutas que produce `providers()` traen el separador
 *  nativo, y el `home` puede traer otro (en win32, un `HOME` de entorno con `/` frente a
 *  un `path.join` que devuelve `\`). Normalizar los dos lados ANTES de compararlos es lo
 *  unico que hace la comparacion valida. */
const toPosix = (p: string): string => p.split(path.sep).join('/').split('\\').join('/');

/** Rutas absolutas → `~/…`, con separadores POSIX, para que la tabla sea la misma en
 *  cualquier maquina y en cualquier sistema operativo que la regenere.
 *
 *  La version anterior comparaba con `startsWith` ANTES de normalizar, asi que en Windows
 *  —donde `path.join` devuelve `\` y el home podia venir con `/`— el prefijo no
 *  coincidia nunca, no abreviaba nada, y la tabla regenerada ahi no era la misma que la
 *  comiteada. Es decir: el documento prometia ser independiente de la maquina y no lo era.
 *  Lo encontro la CI de Windows, no el desarrollo en Linux. */
export function homeRelative(p: string, home: string): string {
    const target = toPosix(p);
    const prefix = toPosix(home);
    return target.startsWith(prefix) ? `~${target.slice(prefix.length)}` : target;
}

function cell(value: string | null, absent: string, home: string): string {
    if (value === null) return absent;
    return `\`${homeRelative(value, home)}\``;
}

/** El tier declarado por la forma de la config — la misma derivacion que `providerTier`
 *  en `core/diagnostics/provider-checks.ts`, no una segunda opinion. */
function tier(c: ProviderConfig): string {
    if (c.hooks) return 'hooks-native';
    if (c.injection?.type === 'config-instructions') return 'config-managed';
    if (c.injection) return 'agents-md-managed';
    return 'context-only';
}

function injectionCell(c: ProviderConfig, home: string): string {
    const inj = c.injection;
    if (!inj) return '— (ninguna)';
    if (inj.type === 'cc-settings-merge') return 'hook `SessionStart`';
    if (inj.type === 'config-instructions') return `\`${homeRelative(inj.configPath, home)}\` → campo \`${inj.field}\``;
    return inj.globalPath === null
        ? `\`${inj.localFile}\` del proyecto (sin equivalente global)`
        : `\`${inj.localFile}\` + \`${homeRelative(inj.globalPath, home)}\``;
}

export function renderProviderTables(): string {
    // `homeDir()`, la MISMA funcion de la que `providers()` deriva sus rutas. Tomarlo
    // por parametro daba dos fuentes para el mismo dato: el generador abreviaba contra
    // el home real y el test contra uno inventado, asi que ninguna ruta empezaba con el
    // prefijo esperado y la tabla salia con rutas absolutas de la maquina que la corrio.
    const home = homeDir();
    const p = providers();
    const row = (a: AgentTarget) => p[a];

    const lines: string[] = [];

    lines.push('### Dónde aterriza cada artefacto');
    lines.push('');
    lines.push('| Agente | Tier | Skills (global) | Skills (proyecto) | Formato |');
    lines.push('|---|---|---|---|---|');
    for (const a of AGENT_TARGETS) {
        const c = row(a);
        lines.push(`| \`${a}\` | ${tier(c)} | ${cell(c.skill.global, '**no soportado**', home)} | \`${c.skill.local}\` | \`${c.skill.renderer}\` |`);
    }
    lines.push('');
    lines.push('### Perfiles de agente, workflows, hooks y contexto');
    lines.push('');
    lines.push('| Agente | Perfiles de agente | Workflows | Hooks | Entrega de contexto | Versión mínima |');
    lines.push('|---|---|---|---|---|---|');
    for (const a of AGENT_TARGETS) {
        const c = row(a);
        const agentCell = c.agent === null
            ? '— (no aplica)'
            : `${cell(c.agent.global, '**no soportado**', home)} · \`${c.agent.renderer}\``;
        const wfCell = c.workflow === null
            ? '— (no aplica)'
            : cell(c.workflow.global, '**no soportado**', home);
        lines.push(
            `| \`${a}\` | ${agentCell} | ${wfCell} | ${c.hooks ? `\`${c.hooks.type}\`` : '— (no tiene)'} ` +
            `| ${injectionCell(c, home)} | ${c.minimumVersion ?? '— (sin gate)'} |`,
        );
    }
    lines.push('');
    lines.push('> Generado desde `cli/src/providers/index.ts`. **No editar a mano** — `npm run docs:matrix` lo regenera y');
    lines.push('> `tests/structural/support-matrix-is-current.test.ts` falla si el documento y el código se separan.');
    return lines.join('\n');
}

/** Reemplaza el bloque entre marcadores. Falla ruidosamente si faltan: un doc sin
 *  marcadores no se "arregla" agregando la tabla al final, se arregla avisando.
 *
 *  Respeta el fin de linea del documento que recibe. Emitia LF siempre, asi que en un
 *  checkout de Windows —donde git entrega el .md con CRLF por defecto— regenerar producia
 *  un archivo de finales mezclados, y la comparacion del test fallaba por bytes que no
 *  tienen nada que ver con el contenido de la tabla. */
export function spliceGenerated(markdown: string, generated: string): string {
    const begin = markdown.indexOf(BEGIN_MARKER);
    const end = markdown.indexOf(END_MARKER);
    if (begin === -1 || end === -1 || end < begin) {
        throw new Error(`support-matrix.md no tiene los marcadores ${BEGIN_MARKER} / ${END_MARKER}`);
    }
    const eol = markdown.includes('\r\n') ? '\r\n' : '\n';
    const block = generated.split('\n').join(eol);
    return markdown.slice(0, begin + BEGIN_MARKER.length)
        + eol + eol + block + eol + eol
        + markdown.slice(end);
}

export const DOC_PATH = path.join(__dirname, '..', '..', 'docs', 'support-matrix.md');

/* istanbul ignore next — entrypoint de CLI, ejercitado por el test via las funciones puras */
if (require.main === module) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    const current = fs.readFileSync(DOC_PATH, 'utf-8');
    fs.writeFileSync(DOC_PATH, spliceGenerated(current, renderProviderTables()), 'utf-8');
    process.stdout.write(`support-matrix.md regenerado desde providers/index.ts\n`);
}
