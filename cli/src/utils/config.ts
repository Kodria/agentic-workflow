// src/utils/config.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AgentTarget } from '../providers';

export interface AwmPreferences {
    defaultAgent: AgentTarget;
    installMethod: 'symlink' | 'copy';
    defaultScope: 'global' | 'local';
}

const DEFAULT_PREFS: AwmPreferences = {
    defaultAgent: 'antigravity',
    installMethod: 'symlink',
    defaultScope: 'local'
};

function prefsDir(): string {
    return process.env.AWM_HOME || path.join(process.env.HOME || os.homedir(), '.awm');
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
