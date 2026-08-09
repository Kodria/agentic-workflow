// cli/src/commands/hooks/codex.ts
//
// Codex hook adapter: merges a single AWM SessionStart entry into
// ~/.codex/hooks.json. Unlike Claude's wrapper-script model, the Codex
// SessionStart entry invokes the installed script directly (no run-hook.cmd
// indirection, no bootstrap-skill symlink).

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getHookConfig } from '../../providers';
import { backupManagedFile, syncExecutable, readStrictJson, checkExecutable } from './shared';
import { writeFileAtomic } from '../../core/atomic-file';
import type { InstallOptions, InstallResult, UninstallResult, HookStatus, CheckResult } from './shared';

function codexMatcher(): string {
    const config = getHookConfig('codex');
    if (!config || config.type !== 'codex-hooks-json') {
        throw new Error('Codex hook configuration is unavailable');
    }
    return config.matcher;
}

export function awmCodexEntry(scriptsDir: string): object {
    return {
        matcher: codexMatcher(),
        hooks: [{
            type: 'command',
            command: path.join(scriptsDir, 'session-start'),
            statusMessage: 'Loading AWM session state',
        }],
    };
}

function isAwmCodexEntry(entry: any, scriptsDir: string): boolean {
    return (
        entry?.matcher === codexMatcher() &&
        Array.isArray(entry?.hooks) &&
        entry.hooks.some((h: any) => typeof h?.command === 'string' && h.command.includes(scriptsDir))
    );
}

export function installCodexHook(options: InstallOptions): InstallResult {
    const config = getHookConfig('codex');
    if (!config || config.type !== 'codex-hooks-json') {
        throw new Error('Codex hook configuration is unavailable');
    }

    const source = path.join(options.registryRoot, 'hooks/codex-session-start');
    if (!fs.existsSync(source)) {
        throw new Error(`Codex hook source missing: ${source}. Run 'awm update' first.`);
    }

    const current = readStrictJson(config.settingsPath);
    const hooks = current.hooks && typeof current.hooks === 'object'
        ? current.hooks as Record<string, unknown>
        : {};
    const entries: any[] = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
    const matches = entries.filter((entry) => isAwmCodexEntry(entry, config.scriptsDir));
    if (matches.length > 1) {
        throw new Error('multiple AWM SessionStart entries in Codex hooks.json');
    }

    const newEntry = awmCodexEntry(config.scriptsDir);

    if (matches.length === 1 && JSON.stringify(matches[0]) === JSON.stringify(newEntry)) {
        return { status: 'already-up-to-date', scriptsDir: config.scriptsDir, settingsPath: config.settingsPath, backupPath: null };
    }

    const nextEntries = matches.length === 1
        ? entries.map((entry) => isAwmCodexEntry(entry, config.scriptsDir) ? newEntry : entry)
        : [...entries, newEntry];

    const merged = { ...current, hooks: { ...hooks, SessionStart: nextEntries } };
    const backupPath = backupManagedFile(config.settingsPath);
    syncExecutable(source, path.join(config.scriptsDir, 'session-start'), options.installMethod);
    writeFileAtomic(config.settingsPath, JSON.stringify(merged, null, 2) + '\n');

    return { status: 'installed', scriptsDir: config.scriptsDir, settingsPath: config.settingsPath, backupPath };
}

function checkCodexSettingsEntry(settingsPath: string, scriptsDir: string, matcher: string, eventName: string): CheckResult {
    if (!fs.existsSync(settingsPath)) {
        return { ok: false, detail: `hooks.json not found: ${settingsPath}` };
    }
    let parsed: any;
    try {
        parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
        return { ok: false, detail: 'hooks.json is not valid JSON' };
    }
    const entries: any[] = parsed?.hooks?.[eventName] ?? [];
    const awmEntry = entries.find((e) =>
        e?.matcher === matcher &&
        (e?.hooks ?? []).some((h: any) => typeof h?.command === 'string' && h.command.includes(scriptsDir))
    );
    if (!awmEntry) {
        return { ok: false, detail: `no AWM SessionStart entry in ${settingsPath}` };
    }
    return { ok: true, detail: settingsPath };
}

function hashFile(file: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Trust derives from ~/.awm/hooks/codex/heartbeat.json, a small file the
 * running session-start hook is expected to write (out of scope for this
 * task — we only read it here). No heartbeat yet => pending-trust (hook
 * installed but never confirmed running). Heartbeat present but its stored
 * hash doesn't match the currently installed script => stale (resynced or
 * tampered with since the last confirmed run). Hash matches => healthy.
 */
function computeCodexTrust(scriptCheck: CheckResult, scriptPath: string, heartbeatPath: string): HookStatus['trust'] {
    if (!scriptCheck.ok) return undefined;
    if (!fs.existsSync(heartbeatPath)) return 'pending-trust';
    let heartbeat: any;
    try {
        heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, 'utf-8'));
    } catch {
        return 'stale';
    }
    return heartbeat?.hash === hashFile(scriptPath) ? 'healthy' : 'stale';
}

export function computeCodexHookStatus(agent: 'codex'): HookStatus {
    const config = getHookConfig(agent);
    if (!config || config.type !== 'codex-hooks-json') {
        throw new Error('Codex hook configuration is unavailable');
    }

    const scriptPath = path.join(config.scriptsDir, 'session-start');
    const heartbeatPath = path.join(config.scriptsDir, 'heartbeat.json');

    const sessionStartScript = checkExecutable(scriptPath);
    const settingsEntry = checkCodexSettingsEntry(config.settingsPath, config.scriptsDir, config.matcher, config.eventName);

    const allOk = sessionStartScript.ok && settingsEntry.ok;
    const settingsOnlyMissing = !settingsEntry.ok && sessionStartScript.ok;

    // Trust only makes sense once the AWM entry is actually present in
    // hooks.json — otherwise there's nothing installed to trust.
    const trust = settingsEntry.ok
        ? computeCodexTrust(sessionStartScript, scriptPath, heartbeatPath)
        : undefined;

    // `overall` IGNORABA `trust` por completo, asi que `awm hooks status` imprimia
    // `Status: HEALTHY` dos lineas debajo de `Trust: … pending-trust`. Una corrida real
    // del playbook leyo esa salida y concluyo que el hook andaba. `doctor --json` decia
    // la verdad; la vista humana, no — y es la que mira una persona. Ver D-010.
    let overall: HookStatus['overall'];
    if (!allOk) overall = settingsOnlyMissing ? 'NOT_INSTALLED' : 'DEGRADED';
    else if (trust === 'stale') overall = 'DEGRADED';
    else if (trust === 'pending-trust') overall = 'PENDING_TRUST';
    else overall = 'HEALTHY';

    return {
        overall,
        trust,
        checks: { sessionStartScript, settingsEntry },
    };
}

export function uninstallCodexHook(agent: 'codex'): UninstallResult {
    const config = getHookConfig(agent);
    if (!config || config.type !== 'codex-hooks-json') {
        throw new Error('Codex hook configuration is unavailable');
    }

    if (!fs.existsSync(config.settingsPath)) {
        return { status: 'not-installed', backupPath: null };
    }

    const current = readStrictJson(config.settingsPath);
    const hooks = current.hooks && typeof current.hooks === 'object'
        ? current.hooks as Record<string, unknown>
        : {};
    const entries: any[] = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
    const beforeLength = entries.length;
    const filtered = entries.filter((e) => !isAwmCodexEntry(e, config.scriptsDir));

    if (filtered.length === beforeLength) {
        return { status: 'not-installed', backupPath: null };
    }

    const backupPath = backupManagedFile(config.settingsPath);

    const nextHooks: Record<string, unknown> = { ...hooks };
    if (filtered.length === 0) {
        delete nextHooks.SessionStart;
    } else {
        nextHooks.SessionStart = filtered;
    }
    const nextConfig: Record<string, unknown> = { ...current, hooks: nextHooks };
    if (Object.keys(nextHooks).length === 0) {
        delete nextConfig.hooks;
    }

    writeFileAtomic(config.settingsPath, JSON.stringify(nextConfig, null, 2) + '\n');

    return { status: 'uninstalled', backupPath };
}

/** Refresh the Codex hook's script file in place (used by resync). Assumes the caller has verified the settings entry is already present. */
export function resyncCodexHookFiles(config: { scriptsDir: string }, registryRoot: string, method: 'symlink' | 'copy'): void {
    const source = path.join(registryRoot, 'hooks/codex-session-start');
    syncExecutable(source, path.join(config.scriptsDir, 'session-start'), method);
}

/** True when the registry has everything needed to resync the Codex hook files. */
export function codexResyncSourcesExist(registryRoot: string): boolean {
    return fs.existsSync(path.join(registryRoot, 'hooks/codex-session-start'));
}
