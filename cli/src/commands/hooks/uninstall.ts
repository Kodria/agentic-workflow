import fs from 'fs';
import path from 'path';
import { AgentTarget, getHookConfig } from '../../providers';

export type UninstallOptions = {
    agent: AgentTarget;
};

export type UninstallResult = {
    status: 'uninstalled' | 'not-installed';
    backupPath: string | null;
};

function backupSettings(settingsPath: string): string | null {
    if (!fs.existsSync(settingsPath)) return null;
    const awmHome = process.env.AWM_HOME || path.join(process.env.HOME!, '.awm');
    const backupDir = path.join(awmHome, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
    const backupPath = path.join(backupDir, `settings.json.${ts}.bak`);
    fs.copyFileSync(settingsPath, backupPath);
    return backupPath;
}

function isAwmEntry(entry: any, scriptsDir: string, matcher: string): boolean {
    return (
        entry?.matcher === matcher &&
        Array.isArray(entry?.hooks) &&
        entry.hooks.some((h: any) => typeof h?.command === 'string' && h.command.includes(scriptsDir))
    );
}

export function uninstallHook(options: UninstallOptions): UninstallResult {
    const config = getHookConfig(options.agent);
    if (!config) {
        throw new Error(`hooks not supported for agent target: ${options.agent}`);
    }

    if (!fs.existsSync(config.settingsPath)) {
        return { status: 'not-installed', backupPath: null };
    }

    let settings: any;
    try {
        settings = JSON.parse(fs.readFileSync(config.settingsPath, 'utf-8'));
    } catch {
        throw new Error(`${config.settingsPath} is not valid JSON. Manual cleanup required.`);
    }

    const entries: any[] = settings?.hooks?.[config.eventName] ?? [];
    const beforeLength = entries.length;
    const filtered = entries.filter((e) => !isAwmEntry(e, config.scriptsDir, config.matcher));

    if (filtered.length === beforeLength) {
        return { status: 'not-installed', backupPath: null };
    }

    const backupPath = backupSettings(config.settingsPath);

    if (filtered.length === 0) {
        delete settings.hooks[config.eventName];
        if (Object.keys(settings.hooks).length === 0) {
            delete settings.hooks;
        }
    } else {
        settings.hooks[config.eventName] = filtered;
    }

    fs.writeFileSync(config.settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

    return { status: 'uninstalled', backupPath };
}
