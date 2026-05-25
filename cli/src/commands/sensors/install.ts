import fs from 'fs';
import path from 'path';
import os from 'os';

const POST_TOOL_USE_EVENT = 'PostToolUse';
const POST_TOOL_USE_MATCHER = 'Write|Edit|MultiEdit';
const AWM_SENSOR_CMD = 'awm sensors run --fast';

type HookEntry = { type: 'command'; command: string; };
type HookMatcher = { matcher: string; hooks: HookEntry[]; };

function defaultSettingsPath(): string {
    return path.join(process.env.HOME ?? os.homedir(), '.claude', 'settings.json');
}

function readSettings(p: string): any {
    if (!fs.existsSync(p)) return {};
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; }
}

function isAwmEntry(e: HookMatcher): boolean {
    return e.matcher === POST_TOOL_USE_MATCHER &&
        (e.hooks ?? []).some(h => h.command === AWM_SENSOR_CMD);
}

function backupSettings(settingsPath: string): string | undefined {
    if (!fs.existsSync(settingsPath)) return undefined;
    const awmHome = process.env.AWM_HOME || path.join(process.env.HOME ?? os.homedir(), '.awm');
    const backupDir = path.join(awmHome, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
    const backupPath = path.join(backupDir, `settings.json.${ts}.sensor.bak`);
    fs.copyFileSync(settingsPath, backupPath);
    return backupPath;
}

export function installSensorHook(settingsPath: string = defaultSettingsPath()): { status: 'installed' | 'already-installed'; backupPath?: string } {
    const settings = readSettings(settingsPath);
    const entries: HookMatcher[] = settings?.hooks?.[POST_TOOL_USE_EVENT] ?? [];

    if (entries.some(isAwmEntry)) return { status: 'already-installed' };

    const backupPath = backupSettings(settingsPath);
    const newEntry: HookMatcher = {
        matcher: POST_TOOL_USE_MATCHER,
        hooks: [{ type: 'command', command: AWM_SENSOR_CMD }],
    };
    const updated = {
        ...settings,
        hooks: {
            ...(settings.hooks ?? {}),
            [POST_TOOL_USE_EVENT]: [...entries, newEntry],
        },
    };

    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2), 'utf-8');
    return { status: 'installed', backupPath };
}

export function uninstallSensorHook(settingsPath: string = defaultSettingsPath()): { status: 'removed' | 'not-found' } {
    if (!fs.existsSync(settingsPath)) return { status: 'not-found' };
    const settings = readSettings(settingsPath);
    const entries: HookMatcher[] = settings?.hooks?.[POST_TOOL_USE_EVENT] ?? [];
    const filtered = entries.filter(e => !isAwmEntry(e));
    if (filtered.length === entries.length) return { status: 'not-found' };

    const updated = { ...settings, hooks: { ...(settings.hooks ?? {}), [POST_TOOL_USE_EVENT]: filtered } };
    if (updated.hooks[POST_TOOL_USE_EVENT].length === 0) delete updated.hooks[POST_TOOL_USE_EVENT];
    if (Object.keys(updated.hooks).length === 0) delete updated.hooks;

    fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2), 'utf-8');
    return { status: 'removed' };
}
