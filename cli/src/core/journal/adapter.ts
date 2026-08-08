// La logica del supervisor no conoce providers: conoce este contrato (R4.8).
import type { ProcessRef } from './types';
import { refIsAlive, activitySnapshot, ActivitySnapshot } from './process';

export type SafeToReplace = 'safe' | 'indeterminate';

export interface ControllerAdapter {
    provider: 'codex' | 'claude-code';
    /** argv estructurado para lanzar/reanudar el controlador (shell:false). */
    launchArgv(resumePrompt: string): string[];
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

const codexAdapter: ControllerAdapter = {
    provider: 'codex',
    launchArgv: (resumePrompt) => ['codex', 'exec', `${RESUME_PROMPT_PREFIX}${resumePrompt}`],
    activity: activitySnapshot,
    safeToReplace: baseSafeToReplace,
};

const claudeAdapter: ControllerAdapter = {
    provider: 'claude-code',
    launchArgv: (resumePrompt) => ['claude', '-p', `${RESUME_PROMPT_PREFIX}${resumePrompt}`],
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

export function adapterFor(provider: string): ControllerAdapter {
    if (provider === 'codex') return codexAdapter;
    if (provider === 'claude-code') return claudeAdapter;
    throw new Error(`provider desconocido: ${provider} (validos: ${WATCH_PROVIDERS.join(', ')})`);
}
