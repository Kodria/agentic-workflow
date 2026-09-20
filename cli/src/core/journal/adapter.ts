// La logica del supervisor no conoce providers: conoce este contrato (R4.8).
import type { ProcessRef } from './types';
import { refIsAlive, activitySnapshot, ActivitySnapshot } from './process';

export type SafeToReplace = 'safe' | 'indeterminate';

/** Postura de autonomia con la que corre el controller desatendido.
 *
 *  `approval-free` es la UNICA postura hoy, y es deliberado: es la unica cuyo
 *  mapeo se pudo leer del `--help` del binario real. Un grado intermedio
 *  ("sandboxed pero sin prompts") exige medir en cada runtime que efectivamente
 *  no pregunte — una postura que igual pregunta reproduce exactamente el stall
 *  que este tipo existe para evitar (#168). No se agregan grados sin medirlos. */
export type ControllerAutonomy = 'approval-free';

export const CONTROLLER_AUTONOMIES = ['approval-free'] as const;

export function isControllerAutonomy(value: unknown): value is ControllerAutonomy {
    return typeof value === 'string' && (CONTROLLER_AUTONOMIES as readonly string[]).includes(value);
}

export interface ControllerAdapter {
    provider: 'codex' | 'claude-code';
    /** argv estructurado para lanzar/reanudar el controlador (shell:false). */
    launchArgv(resumePrompt: string, autonomy?: ControllerAutonomy): string[];
    /** Si el mapeo postura -> flags de ESTE provider esta respaldado por el
     *  `--help` del binario real. 'unverified' NO se lanza a ciegas: la
     *  admision degrada `unattendedController` y bloquea con diagnostico
     *  propio, en vez de inventar una flag que podria no existir (#168). */
    autonomyMapping: 'verified' | 'unverified';
    /** Actividad observable del process group (null = muerto). */
    activity(ref: ProcessRef): ActivitySnapshot | null;
    /** Señal POSITIVA de reemplazo seguro (R4.2b): 'safe' SOLO con evidencia
     *  (hoy: muerte probada de la identidad completa). Ningun adapter de R1
     *  puede observar llamadas de provider en vuelo, asi que con proceso vivo
     *  SIEMPRE devuelve 'indeterminate' => el supervisor entra en custodia
     *  BLOCKED, no mata. El silencio jamas es prueba. */
    safeToReplace(ref: ProcessRef): SafeToReplace;
}

const RESUME_PROMPT_PREFIX = 'Sos el orquestador SDD de este repo. Corre `awm job reconcile` y ejecuta ';

function baseSafeToReplace(ref: ProcessRef): SafeToReplace {
    return refIsAlive(ref) ? 'indeterminate' : 'safe';
}

// `codex exec` tiene flags de aprobacion (`-a/--ask-for-approval never`,
// `-s/--sandbox`), pero la evidencia R0 capturo el `--help` de `codex`, NO el
// del subcomando `exec`, asi que no consta donde van ni como se llaman ahi.
// Declarar el mapeo como 'unverified' y bloquear es honesto; adivinar la flag
// dejaria al controller sin arrancar, que es peor que el stall que arreglamos.
const codexAdapter: ControllerAdapter = {
    provider: 'codex',
    launchArgv: (resumePrompt) => ['codex', 'exec', `${RESUME_PROMPT_PREFIX}${resumePrompt}`],
    autonomyMapping: 'unverified',
    activity: activitySnapshot,
    safeToReplace: baseSafeToReplace,
};

// Leido del `--help` de claude 2.1.278:
//   --permission-mode <mode>  (choices: "acceptEdits", "auto", "bypassPermissions",
//                              "manual", "dontAsk", "plan")
// Las flags van ANTES de `-p`, que toma el prompt como posicional.
const claudeAdapter: ControllerAdapter = {
    provider: 'claude-code',
    launchArgv: (resumePrompt, autonomy) => ['claude',
        ...(autonomy === 'approval-free' ? ['--permission-mode', 'bypassPermissions'] : []),
        '-p', `${RESUME_PROMPT_PREFIX}${resumePrompt}`],
    autonomyMapping: 'verified',
    activity: activitySnapshot,
    safeToReplace: baseSafeToReplace,
};

/** Los providers que `awm watch` sabe supervisar. Exportado para que el CLI valide en
 *  el borde en vez de dejar que un `--provider` invalido llegue hasta el primer tick,
 *  ya con el journal tocado y el lock tomado. */
export const WATCH_PROVIDERS = ['codex', 'claude-code'] as const;

export type WatchProvider = typeof WATCH_PROVIDERS[number];

export function isWatchProvider(value: unknown): value is WatchProvider {
    return typeof value === 'string' && (WATCH_PROVIDERS as readonly string[]).includes(value);
}

/** Nombre del env var que redirige el LANZAMIENTO del controller a un comando propio.
 *  Exportado para que tests y documentacion nunca reescriban el literal. */
export const CONTROLLER_ARGV_ENV = 'AWM_CONTROLLER_ARGV';

/**
 * El supervisor declara no conocer providers: conoce el contrato `ControllerAdapter`. Esa
 * afirmacion era INFALSIFICABLE desde afuera mientras los unicos adapters posibles fueran
 * `codex` y `claude-code` — no habia forma de plantar un controller ajeno y comprobar que
 * el supervisor se comporta igual.
 *
 * `AWM_CONTROLLER_ARGV` cierra eso: un array JSON de strings que reemplaza el argv de
 * lanzamiento, conservando TODO lo demas del adapter elegido (actividad, `safeToReplace`,
 * fencing, custodia). El prompt de la generacion se agrega como ultimo argumento, igual que
 * hacen los adapters nativos, para que el controller reciba su token por la misma via.
 *
 * Array JSON y jamas una linea de shell: es la misma doctrina que el argv de integracion de
 * los tracks (C4) — una string interpretada por un shell convierte un nombre de archivo en
 * un operador. Se valida en el borde: cualquier cosa que no sea un array no vacio de strings
 * no vacios es un error explicito, nunca un fallback silencioso al provider nativo (un
 * override mal escrito que "funciona igual" lanzaria el agente real sin que nadie lo note).
 */
function controllerArgvOverride(): string[] | null {
    const raw = process.env[CONTROLLER_ARGV_ENV]?.trim();
    if (raw === undefined || raw.length === 0) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`${CONTROLLER_ARGV_ENV} debe ser un array JSON de strings, no una linea de shell: ${raw}`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((x) => typeof x !== 'string' || x.length === 0)) {
        throw new Error(`${CONTROLLER_ARGV_ENV} debe ser un array JSON no vacio de strings no vacios: ${raw}`);
    }
    return parsed as string[];
}

/** Lookup PURO del mapeo de postura por provider: sin env, sin throw, para que
 *  la admision pueda preguntarlo sin construir un adapter ni honrar overrides. */
export function controllerAutonomyMapping(provider: string): 'verified' | 'unverified' {
    return provider === 'claude-code' ? claudeAdapter.autonomyMapping
        : provider === 'codex' ? codexAdapter.autonomyMapping
            : 'unverified';
}

export function adapterFor(provider: string): ControllerAdapter {
    const base = provider === 'codex' ? codexAdapter
        : provider === 'claude-code' ? claudeAdapter
            : null;
    if (base === null) throw new Error(`provider desconocido: ${provider} (validos: ${WATCH_PROVIDERS.join(', ')})`);
    const override = controllerArgvOverride();
    if (override === null) return base;
    // El operador es dueno del argv completo: no se le inyecta la postura
    // (duplicaria o contradiria sus propias flags). Sigue necesitando
    // declararla para la admision, que es una afirmacion, no un argv.
    return { ...base, launchArgv: (resumePrompt) => [...override, resumePrompt] };
}
