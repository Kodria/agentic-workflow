// cli/src/commands/hooks/cursor.ts
//
// Cursor hook adapter: merges AWM entries into ~/.cursor/hooks.json (version: 1)
// for sessionStart / preCompact / postToolUse, syncs the three Plan A scripts into
// <AWM_HOME>/hooks/cursor/, and materializes using-awm.md beside them.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { getHookConfig } from '../../providers';
import { backupManagedFile, syncExecutable, readStrictJson, checkExecutable, checkFile } from './shared';
import { writeFileAtomic } from '../../core/atomic-file';
import { buildContext } from '../../core/context/provider';
import { collectAndWarn } from '../../core/orchestrators';
import { listRegistries } from '../../core/registries';
import { compareSemver, machineVersionOpts, normalizePin } from '../../core/versioning';
import type { InstallOptions, InstallResult, UninstallResult, HookStatus, CheckResult } from './shared';

export const CURSOR_HOOKS_REGISTRY_FLOOR = '4.9.0';

export const CURSOR_HOOK_EVENTS = ['sessionStart', 'preCompact', 'postToolUse'] as const;
export type CursorHookEvent = typeof CURSOR_HOOK_EVENTS[number];

const SCRIPT_BY_EVENT: Record<CursorHookEvent, { source: string; dest: string }> = {
    sessionStart: { source: 'hooks/cursor-session-start', dest: 'session-start' },
    preCompact: { source: 'hooks/cursor-pre-compact', dest: 'pre-compact' },
    postToolUse: { source: 'hooks/cursor-post-tool-use', dest: 'post-tool-use' },
};

/** R16.2 — disable deferred re-anchor when delivery is unverified or p95 exceeds 50ms. */
export function shouldDisableDeferredReanchor(metrics: { deliveryVerified: boolean; p95Ms: number }): boolean {
    return metrics.deliveryVerified === false || metrics.p95Ms > 50;
}

export function assertCursorRegistryFloor(version: string | null): void {
    if (version === null) {
        throw new Error(
            `Cursor hooks require baseline registry >= ${CURSOR_HOOKS_REGISTRY_FLOOR}; installed version is unverifiable. Run 'awm update -y'.`,
        );
    }
    try {
        if (compareSemver(version, CURSOR_HOOKS_REGISTRY_FLOOR) < 0) {
            throw new Error(
                `Cursor hooks require baseline registry >= ${CURSOR_HOOKS_REGISTRY_FLOOR}; installed is ${version}. Run 'awm update -y'.`,
            );
        }
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('Cursor hooks require')) throw error;
        throw new Error(
            `Cursor hooks require baseline registry >= ${CURSOR_HOOKS_REGISTRY_FLOOR}; installed version is unverifiable. Run 'awm update -y'.`,
        );
    }
}

function syncDescribeExactTag(repoDir: string): string | null {
    try {
        const out = execFileSync('git', ['describe', '--tags', '--exact-match', 'HEAD'], {
            cwd: repoDir,
            encoding: 'utf8',
            timeout: 2_000,
            maxBuffer: 64 * 1024,
            windowsHide: true,
        }).trim();
        const match = /^v(\d+\.\d+\.\d+)$/.exec(out);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

/** Resolve installed baseline version (pin wins; else exact tag on checkout). */
export function resolveInstalledBaselineVersion(): string | null {
    const { pin } = machineVersionOpts('baseline');
    if (pin) return normalizePin(pin);
    let root: string | undefined;
    try {
        root = listRegistries().find((registry) => registry.name === 'baseline')?.contentRoot;
    } catch {
        return null;
    }
    if (!root || !fs.existsSync(root)) return null;
    return syncDescribeExactTag(root);
}

function cursorConfig() {
    const config = getHookConfig('cursor');
    if (!config || config.type !== 'cursor-hooks-json') {
        throw new Error('Cursor hook configuration is unavailable');
    }
    return config;
}

function writeMaterializedSkill(skillDest: string, registryRoot: string): void {
    const skillSource = path.join(registryRoot, 'skills/using-awm/SKILL.md');
    if (!fs.existsSync(skillSource)) {
        throw new Error(`using-awm skill not found at ${skillSource}. Run 'awm update' first.`);
    }
    const ctx = buildContext({
        registryRoot,
        profileExtensions: [],
        declaredOrchestrators: collectAndWarn(),
    });
    fs.mkdirSync(path.dirname(skillDest), { recursive: true });
    const tmpPath = path.join(
        path.dirname(skillDest),
        `.using-awm.md.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    fs.writeFileSync(tmpPath, ctx.markdown, 'utf-8');
    fs.renameSync(tmpPath, skillDest);
}

export function awmCursorEntry(scriptsDir: string, event: CursorHookEvent): { command: string } {
    return { command: path.join(scriptsDir, SCRIPT_BY_EVENT[event].dest) };
}

function isAwmCursorEntry(entry: unknown, scriptsDir: string, event: CursorHookEvent): boolean {
    const command = (entry as { command?: unknown })?.command;
    return typeof command === 'string' && command === path.join(scriptsDir, SCRIPT_BY_EVENT[event].dest);
}

/** Dead AWM entry: our script basename, not under current scriptsDir, path missing. */
export function isDeadAwmCursorEntry(entry: unknown, currentScriptsDir: string): boolean {
    const command = (entry as { command?: unknown })?.command;
    if (typeof command !== 'string' || command.length === 0) return false;
    const basename = path.basename(command);
    if (!Object.values(SCRIPT_BY_EVENT).some((script) => script.dest === basename)) return false;
    if (path.dirname(command) === currentScriptsDir) return false;
    return !fs.existsSync(command);
}

/**
 * Stale Cursor AWM entries (legacy shapes). Today Cursor only ever wrote the
 * flat `{ command }` form, so there is no legacy matcher/wrapper to retire —
 * live parallel AWM_HOME installs are preserved (same rule as Codex).
 */
export function isStaleAwmCursorEntry(_entry: unknown, _currentScriptsDir: string): boolean {
    return false;
}

function activeEvents(disableDeferred: boolean): CursorHookEvent[] {
    return disableDeferred ? ['sessionStart'] : [...CURSOR_HOOK_EVENTS];
}

function readCursorHooksDocument(settingsPath: string): Record<string, unknown> {
    const current = readStrictJson(settingsPath);
    if (Object.keys(current).length === 0) {
        return { version: 1, hooks: {} };
    }
    if (current.version !== undefined && current.version !== 1) {
        throw new Error(`${settingsPath} has unsupported hooks.json version ${String(current.version)} (expected 1).`);
    }
    return current;
}

function eventArray(hooks: Record<string, unknown>, event: string, settingsPath: string): unknown[] {
    if (!(event in hooks) || hooks[event] === undefined) return [];
    if (!Array.isArray(hooks[event])) {
        throw new Error(`${settingsPath} hooks.${event} must be an array.`);
    }
    return hooks[event] as unknown[];
}

export function installCursorHook(options: InstallOptions): InstallResult {
    const config = cursorConfig();
    const baselineVersion = options.baselineRegistryVersion !== undefined
        ? options.baselineRegistryVersion
        : resolveInstalledBaselineVersion();
    assertCursorRegistryFloor(baselineVersion ?? null);

    for (const event of CURSOR_HOOK_EVENTS) {
        const source = path.join(options.registryRoot, SCRIPT_BY_EVENT[event].source);
        if (!fs.existsSync(source)) {
            throw new Error(`Cursor hook source missing: ${source}. Run 'awm update' first.`);
        }
    }

    const disableDeferred = options.disableDeferredReanchor === true;
    const events = activeEvents(disableDeferred);
    const current = readCursorHooksDocument(config.settingsPath);
    const hooks = current.hooks && typeof current.hooks === 'object' && !Array.isArray(current.hooks)
        ? { ...(current.hooks as Record<string, unknown>) }
        : {};

    let pruned = false;
    let needsWrite = false;
    const nextHooks: Record<string, unknown> = { ...hooks };

    for (const event of CURSOR_HOOK_EVENTS) {
        const raw = eventArray(hooks, event, config.settingsPath);
        const kept = raw.filter((entry) => !isDeadAwmCursorEntry(entry, config.scriptsDir)
            && !isStaleAwmCursorEntry(entry, config.scriptsDir));
        if (kept.length !== raw.length) pruned = true;

        if (!events.includes(event)) {
            // Deferred disabled: drop our AWM entries for deferred events, keep foreign ones.
            const withoutOurs = kept.filter((entry) => !isAwmCursorEntry(entry, config.scriptsDir, event));
            if (withoutOurs.length !== raw.length) needsWrite = true;
            if (withoutOurs.length === 0) delete nextHooks[event];
            else nextHooks[event] = withoutOurs;
            continue;
        }

        const matches = kept.filter((entry) => isAwmCursorEntry(entry, config.scriptsDir, event));
        if (matches.length > 1) {
            throw new Error(`multiple AWM ${event} entries in Cursor hooks.json`);
        }
        const newEntry = awmCursorEntry(config.scriptsDir, event);
        if (matches.length === 1 && JSON.stringify(matches[0]) === JSON.stringify(newEntry)) {
            nextHooks[event] = kept;
            continue;
        }
        needsWrite = true;
        nextHooks[event] = matches.length === 1
            ? kept.map((entry) => (isAwmCursorEntry(entry, config.scriptsDir, event) ? newEntry : entry))
            : [...kept, newEntry];
    }

    if (!pruned && !needsWrite) {
        return {
            status: 'already-up-to-date',
            scriptsDir: config.scriptsDir,
            settingsPath: config.settingsPath,
            backupPath: null,
        };
    }

    const merged = { ...current, version: 1, hooks: nextHooks };
    const backupPath = backupManagedFile(config.settingsPath);
    fs.mkdirSync(config.scriptsDir, { recursive: true });
    for (const event of events) {
        const meta = SCRIPT_BY_EVENT[event];
        syncExecutable(
            path.join(options.registryRoot, meta.source),
            path.join(config.scriptsDir, meta.dest),
            options.installMethod,
        );
    }
    // When deferred is disabled, leave previously synced deferred scripts alone (harmless).
    writeMaterializedSkill(path.join(config.scriptsDir, 'using-awm.md'), options.registryRoot);
    fs.mkdirSync(path.dirname(config.settingsPath), { recursive: true });
    writeFileAtomic(config.settingsPath, JSON.stringify(merged, null, 2) + '\n');

    return {
        status: 'installed',
        scriptsDir: config.scriptsDir,
        settingsPath: config.settingsPath,
        backupPath,
    };
}

function hashFile(file: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function computeCursorTrust(scriptCheck: CheckResult, scriptPath: string, heartbeatPath: string): HookStatus['trust'] {
    if (!scriptCheck.ok) return undefined;
    if (!fs.existsSync(heartbeatPath)) return 'pending-first-run';
    let heartbeat: { hash?: unknown };
    try {
        heartbeat = JSON.parse(fs.readFileSync(heartbeatPath, 'utf-8'));
    } catch {
        return 'stale';
    }
    return heartbeat?.hash === hashFile(scriptPath) ? 'healthy' : 'stale';
}

function checkCursorSettingsEntry(settingsPath: string, scriptsDir: string, disableDeferred = false): CheckResult {
    if (!fs.existsSync(settingsPath)) {
        return { ok: false, detail: `hooks.json not found: ${settingsPath}` };
    }
    let parsed: { version?: unknown; hooks?: Record<string, unknown> };
    try {
        parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
        return { ok: false, detail: 'hooks.json is not valid JSON' };
    }
    if (parsed.version !== 1) {
        return { ok: false, detail: 'hooks.json version is not 1' };
    }
    const events = activeEvents(disableDeferred);
    for (const event of events) {
        const entries = parsed.hooks?.[event];
        if (!Array.isArray(entries) || !entries.some((entry) => isAwmCursorEntry(entry, scriptsDir, event))) {
            return { ok: false, detail: `no AWM ${event} entry in ${settingsPath}` };
        }
    }
    return { ok: true, detail: settingsPath };
}

export function computeCursorHookStatus(agent: 'cursor'): HookStatus {
    const config = getHookConfig(agent);
    if (!config || config.type !== 'cursor-hooks-json') {
        throw new Error('Cursor hook configuration is unavailable');
    }

    const scriptPath = path.join(config.scriptsDir, 'session-start');
    const heartbeatPath = path.join(config.scriptsDir, 'heartbeat.json');
    const sessionStartScript = checkExecutable(scriptPath);
    const bootstrapSkill = checkFile(path.join(config.scriptsDir, 'using-awm.md'));
    const settingsEntry = checkCursorSettingsEntry(config.settingsPath, config.scriptsDir);

    const allOk = sessionStartScript.ok && settingsEntry.ok && bootstrapSkill.ok;
    const settingsOnlyMissing = !settingsEntry.ok && sessionStartScript.ok;

    const trust = settingsEntry.ok
        ? computeCursorTrust(sessionStartScript, scriptPath, heartbeatPath)
        : undefined;

    let overall: HookStatus['overall'];
    if (!allOk) overall = settingsOnlyMissing && bootstrapSkill.ok ? 'NOT_INSTALLED' : 'DEGRADED';
    else if (trust === 'stale') overall = 'DEGRADED';
    else if (trust === 'pending-first-run') overall = 'PENDING_TRUST';
    else overall = 'HEALTHY';

    return {
        overall,
        trust,
        checks: { sessionStartScript, settingsEntry, bootstrapSkill },
    };
}

export function uninstallCursorHook(agent: 'cursor'): UninstallResult {
    const config = getHookConfig(agent);
    if (!config || config.type !== 'cursor-hooks-json') {
        throw new Error('Cursor hook configuration is unavailable');
    }

    if (!fs.existsSync(config.settingsPath)) {
        return { status: 'not-installed', backupPath: null };
    }

    const current = readStrictJson(config.settingsPath);
    const hooks = current.hooks && typeof current.hooks === 'object' && !Array.isArray(current.hooks)
        ? { ...(current.hooks as Record<string, unknown>) }
        : {};

    let removed = false;
    const nextHooks: Record<string, unknown> = { ...hooks };
    for (const event of CURSOR_HOOK_EVENTS) {
        if (!Array.isArray(hooks[event])) continue;
        const entries = hooks[event] as unknown[];
        const filtered = entries.filter((entry) => !isAwmCursorEntry(entry, config.scriptsDir, event));
        if (filtered.length !== entries.length) removed = true;
        if (filtered.length === 0) delete nextHooks[event];
        else nextHooks[event] = filtered;
    }

    if (!removed) return { status: 'not-installed', backupPath: null };

    const backupPath = backupManagedFile(config.settingsPath);
    const nextConfig: Record<string, unknown> = { ...current, hooks: nextHooks };
    if (Object.keys(nextHooks).length === 0) delete nextConfig.hooks;
    writeFileAtomic(config.settingsPath, JSON.stringify(nextConfig, null, 2) + '\n');
    return { status: 'uninstalled', backupPath };
}

export function resyncCursorHookFiles(
    config: { scriptsDir: string },
    registryRoot: string,
    method: 'symlink' | 'copy',
): void {
    for (const event of CURSOR_HOOK_EVENTS) {
        const meta = SCRIPT_BY_EVENT[event];
        const source = path.join(registryRoot, meta.source);
        if (!fs.existsSync(source)) {
            throw new Error(`Cursor hook source missing: ${source}. Run 'awm update' first.`);
        }
        syncExecutable(source, path.join(config.scriptsDir, meta.dest), method);
    }
    writeMaterializedSkill(path.join(config.scriptsDir, 'using-awm.md'), registryRoot);
}

export function cursorResyncSourcesExist(registryRoot: string): boolean {
    return CURSOR_HOOK_EVENTS.every((event) =>
        fs.existsSync(path.join(registryRoot, SCRIPT_BY_EVENT[event].source)));
}
