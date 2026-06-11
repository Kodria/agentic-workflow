import fs from 'fs';
import path from 'path';
import { AgentTarget, getHookConfig } from '../../providers';

export type InstallOptions = {
    agent: AgentTarget;
    registryRoot: string;
    installMethod: 'symlink' | 'copy';
};

export type InstallResult = {
    status: 'installed' | 'already-up-to-date';
    scriptsDir: string;
    settingsPath: string;
    backupPath: string | null;
};

export function syncFile(source: string, dest: string, method: 'symlink' | 'copy'): void {
    try { fs.unlinkSync(dest); } catch { /* not exists, fine */ }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (method === 'symlink') {
        fs.symlinkSync(source, dest);
    } else {
        fs.copyFileSync(source, dest);
        const srcMode = fs.statSync(source).mode;
        fs.chmodSync(dest, srcMode);
    }
}

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

export function installHook(options: InstallOptions): InstallResult {
    const config = getHookConfig(options.agent);
    if (!config) {
        throw new Error(`hooks not supported for agent target: ${options.agent}`);
    }

    // 1. Verify registry sources exist FIRST (before touching settings)
    const sourceHooks = path.join(options.registryRoot, 'hooks');
    const sourceSkill = path.join(options.registryRoot, 'skills/using-awm/SKILL.md');
    if (!fs.existsSync(path.join(sourceHooks, 'session-start'))) {
        throw new Error(`AWM registry not found at ${sourceHooks}. Run 'awm update' to refresh the registry.`);
    }
    if (!fs.existsSync(sourceSkill)) {
        throw new Error(`using-awm skill not found at ${sourceSkill}. Run 'awm update' first.`);
    }

    // 2. Sync scripts
    fs.mkdirSync(config.scriptsDir, { recursive: true });
    syncFile(path.join(sourceHooks, 'session-start'), path.join(config.scriptsDir, 'session-start'), options.installMethod);
    syncFile(path.join(sourceHooks, 'run-hook.cmd'), path.join(config.scriptsDir, 'run-hook.cmd'), options.installMethod);

    // 3. Symlink the skill (ALWAYS symlink so awm update propagates)
    const skillDest = path.join(config.scriptsDir, 'using-awm.md');
    try { fs.unlinkSync(skillDest); } catch { /* not exists */ }
    fs.symlinkSync(sourceSkill, skillDest);

    // 4. Backup settings if it exists
    const backupPath = backupSettings(config.settingsPath);

    // 5. Read or initialize settings
    let settings: any = {};
    if (fs.existsSync(config.settingsPath)) {
        const raw = fs.readFileSync(config.settingsPath, 'utf-8');
        try {
            settings = JSON.parse(raw);
        } catch {
            throw new Error(`${config.settingsPath} is not valid JSON. Backup created at ${backupPath}. Fix the file manually, then re-run.`);
        }
    } else {
        fs.mkdirSync(path.dirname(config.settingsPath), { recursive: true });
    }

    // 6. Merge AWM entry
    if (!settings.hooks) settings.hooks = {};
    if (!settings.hooks[config.eventName]) settings.hooks[config.eventName] = [];

    const entries: any[] = settings.hooks[config.eventName];
    const awmEntryIdx = entries.findIndex((e) => isAwmEntry(e, config.scriptsDir, config.matcher));
    const newEntry = {
        matcher: config.matcher,
        hooks: [{
            type: 'command',
            command: `${path.join(config.scriptsDir, 'run-hook.cmd')} session-start`,
            async: false
        }]
    };

    let status: InstallResult['status'];
    if (awmEntryIdx >= 0) {
        if (JSON.stringify(entries[awmEntryIdx]) === JSON.stringify(newEntry)) {
            return { status: 'already-up-to-date', scriptsDir: config.scriptsDir, settingsPath: config.settingsPath, backupPath: null };
        }
        entries[awmEntryIdx] = newEntry;
        status = 'installed';
    } else {
        entries.push(newEntry);
        status = 'installed';
    }

    // 7. Write settings
    fs.writeFileSync(config.settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

    return { status, scriptsDir: config.scriptsDir, settingsPath: config.settingsPath, backupPath };
}
