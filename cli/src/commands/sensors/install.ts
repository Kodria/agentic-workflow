import fs from 'fs';
import path from 'path';
import { homeDir, awmHome } from '../../core/paths';
import { readStrictJson } from '../hooks/shared';
import { writeFileAtomic } from '../../core/atomic-file';
import { getSettingsMergeHookConfig } from '../../providers';

const POST_TOOL_USE_EVENT = 'PostToolUse';
const POST_TOOL_USE_MATCHER = 'Write|Edit|MultiEdit';
const AWM_SENSOR_CMD = 'awm sensors run --fast';

type HookEntry = { type: 'command'; command: string; };
type HookMatcher = { matcher: string; hooks: HookEntry[]; };

function defaultSettingsPath(): string {
    // Se toma de la config del provider, no de una ruta hardcodeada: era la
    // cuarta copia de este path en el codigo.
    return getSettingsMergeHookConfig('claude-code').settingsPath;
}

/** Lectura ESTRICTA, compartida con los demas escritores de este archivo.
 *
 *  Antes esto era `try { JSON.parse(...) } catch { return {} }` y el `{}` se
 *  escribia de vuelta — asi que un JSON malformado (una coma de mas, el error
 *  de edicion a mano mas comun) BORRABA el settings.json entero del usuario y
 *  la operacion reportaba exito. Verificado destruyendo `model`, `permissions`
 *  y el propio hook SessionStart de AWM. El escritor hermano
 *  (`installClaudeHook`) ya se negaba correctamente ante el mismo archivo.
 *
 *  AWM hace MERGE sobre archivos que son del usuario; nunca los clobberea. Ante
 *  un archivo que no se puede parsear, la unica accion segura es negarse. */
function readSettings(p: string): any {
    return readStrictJson(p);
}

function isAwmEntry(e: HookMatcher): boolean {
    return e.matcher === POST_TOOL_USE_MATCHER &&
        (e.hooks ?? []).some(h => h.command === AWM_SENSOR_CMD);
}

function backupSettings(settingsPath: string): string | undefined {
    if (!fs.existsSync(settingsPath)) return undefined;
    const backupDir = path.join(awmHome(), 'backups');
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
    writeFileAtomic(settingsPath, `${JSON.stringify(updated, null, 2)}\n`);
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

    writeFileAtomic(settingsPath, `${JSON.stringify(updated, null, 2)}\n`);
    return { status: 'removed' };
}
