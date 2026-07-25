// cli/src/commands/hooks/shared.ts
//
// Small helpers shared between the per-agent hook adapters (claude.ts, codex.ts).
// Each adapter owns its own entry shape / merge semantics; this module only
// generalizes the parts that are identical regardless of which JSON file or
// which single script is being managed.

import fs from 'fs';
import path from 'path';
import { awmHome } from '../../core/paths';

/**
 * Sync a single managed file (script, wrapper, skill doc, ...) from `source`
 * to `dest` via symlink (default; lets `awm update` propagate registry
 * changes) or copy (fallback for platforms without symlink support).
 */
export function syncExecutable(source: string, dest: string, method: 'symlink' | 'copy'): void {
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

/**
 * Backup any AWM-managed JSON config file (Claude's settings.json, Codex's
 * hooks.json, ...) before mutating it. Returns null if the file doesn't
 * exist yet (nothing to back up).
 */
export function backupManagedFile(filePath: string): string | null {
    if (!fs.existsSync(filePath)) return null;
    const backupDir = path.join(awmHome(), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
    const backupPath = path.join(backupDir, `${path.basename(filePath)}.${ts}.bak`);
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
}

/**
 * Parse a JSON config file. Missing file => {} (nothing configured yet).
 * Malformed JSON => throws a clear, actionable error instead of silently
 * clobbering whatever the user (or another tool) put there.
 */
export function readStrictJson(filePath: string): Record<string, any> {
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf-8');
    try {
        return JSON.parse(raw);
    } catch {
        throw new Error(`${filePath} is not valid JSON. Fix the file manually, then re-run.`);
    }
}

export type CheckResult = {
    ok: boolean;
    detail: string;
};

export function checkExecutable(file: string): CheckResult {
    if (!fs.existsSync(file)) {
        return { ok: false, detail: `missing: ${file}` };
    }
    try {
        fs.accessSync(file, fs.constants.X_OK);
        return { ok: true, detail: file };
    } catch {
        return { ok: false, detail: `not executable: ${file}` };
    }
}

export function checkFile(file: string): CheckResult {
    if (!fs.existsSync(file)) {
        return { ok: false, detail: `missing: ${file}` };
    }
    try {
        fs.statSync(file);
        return { ok: true, detail: file };
    } catch {
        return { ok: false, detail: `broken link: ${file}` };
    }
}
