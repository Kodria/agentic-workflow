// src/utils/config.ts
import fs from 'fs';
import path from 'path';
import { AgentTarget, isAgentTarget } from '../providers';
import { awmHome } from '../core/paths';
import { writeFileAtomic } from '../core/atomic-file';

export interface AwmPreferences {
    defaultAgent: AgentTarget;
    enabledAgents: AgentTarget[];
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
    enabledAgents: ['claude-code'],
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

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function normalizePreferences(
    value: unknown,
    allowEnabledAgentsMigration = true,
): { prefs: AwmPreferences; changed: boolean } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('preferences.json must contain a JSON object');
    }

    const raw = value as Record<string, unknown>;
    if (!isAgentTarget(raw.defaultAgent)) {
        throw new Error('preferences.json has an invalid defaultAgent');
    }
    if (raw.installMethod !== 'symlink' && raw.installMethod !== 'copy') {
        throw new Error('preferences.json has an invalid installMethod');
    }
    if (raw.defaultScope !== 'global' && raw.defaultScope !== 'local') {
        throw new Error('preferences.json has an invalid defaultScope');
    }
    if (raw.baseRemote !== undefined && !isNonEmptyString(raw.baseRemote)) {
        throw new Error('preferences.json has an invalid baseRemote');
    }
    if (raw.channel !== undefined && raw.channel !== 'stable' && raw.channel !== 'dev') {
        throw new Error('preferences.json has an invalid channel');
    }
    if (raw.pins !== undefined && (
        !isPlainObject(raw.pins) ||
        !Object.entries(raw.pins).every(([name, version]) =>
            isNonEmptyString(name) && isNonEmptyString(version))
    )) {
        throw new Error('preferences.json has invalid pins');
    }

    if (raw.enabledAgents === undefined && !allowEnabledAgentsMigration) {
        throw new Error('preferences.json has an invalid enabledAgents');
    }
    const source = raw.enabledAgents === undefined ? [raw.defaultAgent] : raw.enabledAgents;
    if (!Array.isArray(source) || !source.every(isAgentTarget)) {
        throw new Error('preferences.json has an invalid enabledAgents');
    }

    const enabledAgents = Array.from(new Set(source));
    if (!enabledAgents.includes(raw.defaultAgent)) {
        throw new Error('preferences.json defaultAgent must be included in enabledAgents');
    }

    const prefs = { ...raw, enabledAgents } as unknown as AwmPreferences;
    return {
        prefs,
        changed: raw.enabledAgents === undefined ||
            JSON.stringify(source) !== JSON.stringify(enabledAgents),
    };
}

/**
 * Las preferencias TAL COMO ESTAN, sin escribir nada. Devuelve los defaults en memoria
 * cuando el archivo no existe todavia.
 *
 * `getPreferences` auto-vivifica: si no hay archivo, lo crea con los defaults. Eso esta
 * bien para un comando que va a configurar la maquina, y esta mal para uno que solo
 * mira. `awm doctor` —documentado como «Read-only dashboard. Changes nothing.»— lo
 * llamaba, asi que en una maquina limpia el comando de inspeccion dejaba un
 * `preferences.json` con `claude-code` como agente por defecto, que despues se lee como
 * «el usuario configuro esto» cuando no lo hizo. Lo encontro el playbook de aceptacion,
 * no la suite: ningun test preguntaba si un comando de lectura escribia.
 *
 * Se midieron los otros siete comandos de inspeccion (`list`, `preflight`, `sensors
 * status`, `context-budget`, `backup list`, `ledger list`, `registry status`): todos
 * limpios. `doctor` era el unico.
 */
export function readPreferences(): AwmPreferences {
    const loaded = loadPreferences();
    return loaded.exists
        ? loaded.prefs
        : { ...DEFAULT_PREFS, enabledAgents: [...DEFAULT_PREFS.enabledAgents] };
}

export function getPreferences(): AwmPreferences {
    const loaded = loadPreferences();
    if (!loaded.exists) {
        savePreferences(DEFAULT_PREFS);
        return { ...DEFAULT_PREFS, enabledAgents: [...DEFAULT_PREFS.enabledAgents] };
    }
    if (loaded.migrationRequired) savePreferences(loaded.prefs);
    return loaded.prefs;
}

export function loadPreferences(initialAgent: AgentTarget = 'claude-code'): {
    prefs: AwmPreferences;
    exists: boolean;
    migrationRequired: boolean;
} {
    if (!isAgentTarget(initialAgent)) {
        throw new Error('initialAgent must be a valid agent target');
    }

    const file = prefsFile();
    if (!fs.existsSync(file)) {
        const prefs = {
            ...DEFAULT_PREFS,
            defaultAgent: initialAgent,
            enabledAgents: [initialAgent],
        };
        return { prefs, exists: false, migrationRequired: true };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        throw new Error(`${file} is not valid JSON. Fix it manually, then re-run.`);
    }

    const result = normalizePreferences(parsed);
    return { prefs: result.prefs, exists: true, migrationRequired: result.changed };
}

export function savePreferences(prefs: AwmPreferences): void {
    const normalized = normalizePreferences(prefs, false).prefs;
    // `writeFileAtomic`, not a second hand-rolled write-temp-then-rename. The local copy
    // predated the primitive and had drifted below it: no fsync, a pid-only temp name,
    // and none of the guards the shared one grew. Same 0o600 intent and same
    // mode-preservation semantics as `artifact-state.ts`, the other 0o600 file written
    // through it — a file of this sensitivity has an established treatment here.
    writeFileAtomic(prefsFile(), JSON.stringify(normalized, null, 2) + '\n', 0o600);
}

export function enableAgent(prefs: AwmPreferences, agent: AgentTarget): AwmPreferences {
    normalizePreferences(prefs);
    if (!isAgentTarget(agent)) {
        throw new Error('agent must be a valid agent target');
    }
    return prefs.enabledAgents.includes(agent)
        ? prefs
        : { ...prefs, enabledAgents: [...prefs.enabledAgents, agent] };
}
