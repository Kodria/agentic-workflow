// cli/src/commands/hooks/shared.ts
//
// Small helpers shared between the per-agent hook adapters (claude.ts, codex.ts).
// Each adapter owns its own entry shape / merge semantics; this module only
// generalizes the parts that are identical regardless of which JSON file or
// which single script is being managed.

import fs from 'fs';
import path from 'path';
import { AgentTarget } from '../../providers';
import { awmHome } from '../../core/paths';

// Types shared between the dispatchers (install.ts/uninstall.ts/status.ts,
// which pick an adapter by config.type) and the per-agent adapters
// (claude.ts/codex.ts, which need these same shapes for their own return
// values). Living here — a leaf module with no dependency on either side —
// avoids the circular import a dispatcher -> adapter -> dispatcher chain
// would otherwise create (dispatchers import adapter functions; adapters
// only ever needed these types, not any dispatcher function).
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

export type UninstallOptions = {
    agent: AgentTarget;
};

export type UninstallResult = {
    status: 'uninstalled' | 'not-installed';
    backupPath: string | null;
};

/**
 * Sync a single managed file (script, wrapper, skill doc, ...) from `source`
 * to `dest` via symlink (default; lets `awm update` propagate registry
 * changes) or copy (fallback for platforms without symlink support).
 */
export function syncExecutable(source: string, dest: string, method: 'symlink' | 'copy'): void {
    try { fs.unlinkSync(dest); } catch { /* not exists, fine */ }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (method === 'symlink') {
        try {
            // 'file' explicito: el destino es un archivo. Sin el tipo, Node lo INFIERE
            // del target y en Windows puede crear un symlink de DIRECTORIO, que
            // exige SeCreateSymbolicLinkPrivilege. El fallback a copia de abajo lo
            // cubria, pero el tipo correcto en la llamada no depende de que alguien
            // conserve el try/catch al editarla.
            fs.symlinkSync(source, dest, 'file');
        } catch {
            // best-effort: a FILE symlink needs SeCreateSymbolicLinkPrivilege on
            // Windows, denied by default on unprivileged accounts (incl. GitHub
            // Actions' windows-latest runner) — fall back to a plain copy, same
            // as the bootstrap skill file's own fallback (hooks/claude.ts) and
            // executor.ts's stageArtifact for file artifacts. 'awm update' will
            // not auto-propagate for this file until re-synced, same tradeoff.
            fs.copyFileSync(source, dest);
            const srcMode = fs.statSync(source).mode;
            fs.chmodSync(dest, srcMode);
        }
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

export type HookStatus = {
    /** `PENDING_TRUST`: instalado y bien formado, pero NUNCA se lo vio correr. No es
     *  `HEALTHY` — un hook que nunca corrio no se puede afirmar que entregue contexto —
     *  y tampoco `DEGRADED`, porque no hay nada roto que arreglar. Ver D-010. */
    overall: 'HEALTHY' | 'DEGRADED' | 'NOT_INSTALLED' | 'PENDING_TRUST';
    // Codex-only: whether a runtime heartbeat confirms the installed script
    // matches what actually ran last session. Absent for agents (Claude)
    // that don't have a heartbeat mechanism.
    trust?: 'pending-trust' | 'healthy' | 'stale';
    checks: {
        // Claude-only checks (the using-awm.md bootstrap skill symlink and the
        // run-hook.cmd wrapper script). Absent for agents without them.
        bootstrapSkill?: CheckResult;
        sessionStartScript: CheckResult;
        runHookWrapper?: CheckResult;
        settingsEntry: CheckResult;
    };
};
