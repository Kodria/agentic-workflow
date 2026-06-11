// src/core/registry.ts
//
// Identidad del registry base (WS-4): el CLI no clona ni buildea nada acá —
// solo conoce el remote default que `awm init` siembra en registries.json.
import { getPreferences } from "../utils/config";

export const DEFAULT_REMOTE = "https://github.com/Kodria/awm-baseline-registry.git";

export type BaseRemoteSource = 'env' | 'prefs' | 'default';

/** Remote efectivo del registry base y su origen: env AWM_BASE_REMOTE > preferences.baseRemote > DEFAULT_REMOTE. */
export function resolveBaseRemoteInfo(): { remote: string; source: BaseRemoteSource } {
    if (process.env.AWM_BASE_REMOTE) return { remote: process.env.AWM_BASE_REMOTE, source: 'env' };
    try {
        const prefs = getPreferences();
        if (prefs.baseRemote) return { remote: prefs.baseRemote, source: 'prefs' };
    } catch {
        // preferencias ilegibles no deben bloquear — cae al default
    }
    return { remote: DEFAULT_REMOTE, source: 'default' };
}

export function resolveBaseRemote(): string {
    return resolveBaseRemoteInfo().remote;
}
