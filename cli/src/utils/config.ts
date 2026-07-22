// src/utils/config.ts
import fs from 'fs';
import path from 'path';
import type { AgentTarget } from '../providers';
import { awmHome } from '../core/paths';

export interface AwmPreferences {
    defaultAgent: AgentTarget;
    installMethod: 'symlink' | 'copy';
    defaultScope: 'global' | 'local';
    /** Remote del registry base (override de DEFAULT_REMOTE). Opcional — WS-2. */
    baseRemote?: string;
    /** Canal de updates: 'stable' (último tag, default si ausente) | 'dev' (HEAD). Opcional — WS-3. */
    channel?: 'stable' | 'dev';
    /** Pins de versión por registry configurado (p.ej. 'baseline'). Valores "X.Y.Z" sin prefijo v. Opcional — WS-3/WS-4. */
    pins?: Record<string, string>;
}

const DEFAULT_PREFS: AwmPreferences = {
    // claude-code matches `awm init`'s own documented default (see init.ts / `awm init --help`).
    // Previously 'antigravity', which silently mis-installed bundles in claude-code
    // environments when `awm add` (the first getPreferences caller) stamped it to disk (#7).
    defaultAgent: 'claude-code',
    installMethod: 'symlink',
    defaultScope: 'local'
};

function prefsDir(): string {
    return awmHome();
}

function prefsFile(): string {
    return path.join(prefsDir(), 'preferences.json');
}

/** True if preferences.json is already on disk (no side effect — does NOT create it). */
export function preferencesExist(): boolean {
    return fs.existsSync(prefsFile());
}

export function getPreferences(): AwmPreferences {
    const file = path.join(prefsDir(), 'preferences.json');
    if (!fs.existsSync(file)) {
        savePreferences(DEFAULT_PREFS);
        return DEFAULT_PREFS;
    }
    const raw = fs.readFileSync(file, 'utf-8');
    return JSON.parse(raw) as AwmPreferences;
}

export function savePreferences(prefs: AwmPreferences): void {
    const dir = prefsDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(dir, 'preferences.json'), JSON.stringify(prefs, null, 2), 'utf-8');
}
