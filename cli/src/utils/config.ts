// src/utils/config.ts
import fs from 'fs';
import path from 'path';
import { AgentTarget, isAgentTarget } from '../providers';
import { awmHome } from '../core/paths';

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

function normalizePreferences(value: unknown): { prefs: AwmPreferences; changed: boolean } {
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

type LegacyAwmPreferences = Omit<AwmPreferences, 'enabledAgents'> & {
    enabledAgents?: AgentTarget[];
};

export function savePreferences(prefs: AwmPreferences): void;
export function savePreferences(prefs: LegacyAwmPreferences): void;
export function savePreferences(prefs: AwmPreferences | LegacyAwmPreferences): void {
    const normalized = normalizePreferences(prefs).prefs;
    const file = prefsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(normalized, null, 2) + '\n', {
        encoding: 'utf8',
        mode: 0o600,
    });
    fs.renameSync(temp, file);
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
