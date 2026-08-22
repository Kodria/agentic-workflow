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
        return { ok: false, detail: `cannot read file: ${file}` };
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
        // Claude-only checks (the materialized using-awm.md bootstrap skill file
        // and the run-hook.cmd wrapper script). Absent for agents without them.
        bootstrapSkill?: CheckResult;
        sessionStartScript: CheckResult;
        runHookWrapper?: CheckResult;
        settingsEntry: CheckResult;
    };
};

/**
 * Entradas de hook con NUESTRA forma cuyo script ya no existe en disco.
 *
 * `awm init` reconoce como propia solo la entrada que apunta al `AWM_HOME` actual, asi
 * que instalar con otro `AWM_HOME` AGREGA una segunda en vez de reemplazar. Una corrida
 * de playbook aislada deja en el archivo real una entrada permanente hacia un directorio
 * temporal ya borrado, y el agente intenta ejecutarla en cada sesion, para siempre.
 * Observado en una corrida real: `~/.codex/hooks.json` con dos entradas de AWM.
 *
 * Tres condiciones, a proposito — es el archivo de configuracion DEL USUARIO y no se le
 * borran lineas por parecido vago:
 *   1. el `matcher` es exactamente el nuestro,
 *   2. el ejecutable se llama como el script que AWM instala, y
 *   3. esa ruta NO existe.
 *
 * Una instalacion paralela viva no cumple (3), asi que sobrevive intacta. Lo unico que
 * se poda es basura que AWM misma dejo y que ya no puede funcionar.
 */
export function isDeadAwmHookEntry(
    entry: unknown,
    matcher: string,
    scriptBasename: string,
    currentScriptsDir: string,
): boolean {
    const e = entry as { matcher?: unknown; hooks?: unknown };
    if (e?.matcher !== matcher || !Array.isArray(e.hooks)) return false;
    return e.hooks.some((h: unknown) => {
        const command = (h as { command?: unknown })?.command;
        if (typeof command !== 'string' || command.length === 0) return false;
        // Claude invoca `<ruta>/run-hook.cmd session-start`: el ejecutable es el primer
        // token. Codex invoca la ruta pelada. Partir por espacio cubre las dos formas.
        const executable = command.split(' ')[0];
        if (path.basename(executable) !== scriptBasename) return false;
        // La entrada del AWM_HOME ACTUAL nunca es basura, aunque el script todavia no
        // este en disco: en una instalacion nueva el archivo aparece unos pasos despues.
        // Sin esta guarda, un `hooks.json` con dos entradas duplicadas del home actual se
        // podaba entero y el guard de duplicados (R17) dejaba de dispararse — lo detecto
        // su propio test al agregar la poda.
        if (path.dirname(executable) === currentScriptsDir) return false;
        return !fs.existsSync(executable);
    });
}
