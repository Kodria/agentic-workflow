// src/utils/config.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface AwmPreferences {
    defaultAgent: 'antigravity' | 'opencode';
    installMethod: 'symlink' | 'copy';
    defaultScope: 'global' | 'local';
}

const DEFAULT_PREFS: AwmPreferences = {
    defaultAgent: 'antigravity',
    installMethod: 'symlink',
    defaultScope: 'local'
};

const PREFS_DIR = path.join(os.homedir(), '.awm');
const PREFS_FILE = path.join(PREFS_DIR, 'preferences.json');

export function getPreferences(): AwmPreferences {
    if (!fs.existsSync(PREFS_FILE)) {
        savePreferences(DEFAULT_PREFS);
        return DEFAULT_PREFS;
    }
    const raw = fs.readFileSync(PREFS_FILE, 'utf-8');
    return JSON.parse(raw) as AwmPreferences;
}

export function savePreferences(prefs: AwmPreferences): void {
    if (!fs.existsSync(PREFS_DIR)) {
        fs.mkdirSync(PREFS_DIR, { recursive: true });
    }
    fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf-8');
}
