// cli/src/commands/hooks/claude.ts
//
// Claude Code hook adapter: merges a single AWM SessionStart entry into
// ~/.claude/settings.json, keyed by matcher + scriptsDir substring match.
// Extracted verbatim (behavior-preserving) from the former monolithic
// install.ts/status.ts/uninstall.ts — see tests/commands/hooks/install.test.ts's
// characterization test for the frozen contract this must keep honoring.

import fs from 'fs';
import path from 'path';
import { getSettingsMergeHookConfig } from '../../providers';
import { isDeadAwmHookEntry, backupManagedFile, syncExecutable, checkExecutable, checkFile } from './shared';
import type { InstallOptions, InstallResult, UninstallResult, HookStatus, CheckResult } from './shared';
import { buildContext } from '../../core/context/provider';
import { collectAndWarn } from '../../core/orchestrators';

/**
 * Materializa el payload compuesto (using-awm + orquestadores declarados) en `skillDest`.
 *
 * Antes `using-awm.md` era un symlink al SKILL.md crudo del registry: todo lo que
 * `buildContext` compone (declared orchestrators — Tasks 1-4) nunca llegaba a Claude
 * Code, el proveedor PRINCIPAL que este framework existe para servir. Se escribe el
 * archivo en vez de enlazarlo porque el contenido ya no es un archivo del registry sino
 * un derivado suyo — igual que `materialize()` hace para los demas proveedores
 * (core/context/materializer.ts), solo que aca el destino es el propio scriptsDir del
 * hook en vez del awm-context.md generico.
 *
 * Usada por `installClaudeHook` Y por `resyncClaudeHookFiles` — con proposito: si solo
 * una de las dos escribiera el payload materializado, la otra seguiria symlinkeando al
 * SKILL.md crudo y el siguiente `awm update` reabriria el mismo bypass que esto cierra.
 *
 * Escritura atomica via write-then-rename (post-implementation-qa Finding 1, TOCTOU):
 * el patron previo (`unlinkSync` seguido de `writeFileSync`) dejaba una ventana entre
 * ambas llamadas donde un symlink recreado en `skillDest` seria seguido por
 * `writeFileSync` (que no usa `O_EXCL`), escribiendo a traves de el sobre lo que sea
 * que apunte. Escribir a un temporal unico en el MISMO directorio (para que el rename
 * quede en el mismo filesystem y sea atomico) y luego `renameSync` al destino evita eso
 * por completo: el rename reemplaza la entrada de directorio de forma atomica sin
 * dereferenciar un symlink preexistente en el destino, y sin ventana entre borrar y
 * escribir — no hace falta unlink previo, el rename ya sobrescribe en un solo paso.
 */
function writeMaterializedSkill(skillDest: string, registryRoot: string): void {
    const ctx = buildContext({
        registryRoot,
        profileExtensions: [],
        declaredOrchestrators: collectAndWarn(),
    });
    const tmpPath = path.join(path.dirname(skillDest), `.using-awm.md.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(tmpPath, ctx.markdown, 'utf-8');
    fs.renameSync(tmpPath, skillDest);
}

function isAwmEntry(entry: any, scriptsDir: string, matcher: string): boolean {
    return (
        entry?.matcher === matcher &&
        Array.isArray(entry?.hooks) &&
        entry.hooks.some((h: any) => typeof h?.command === 'string' && h.command.includes(scriptsDir))
    );
}

export function installClaudeHook(options: InstallOptions): InstallResult {
    const config = getSettingsMergeHookConfig(options.agent);

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
    syncExecutable(path.join(sourceHooks, 'session-start'), path.join(config.scriptsDir, 'session-start'), options.installMethod);
    syncExecutable(path.join(sourceHooks, 'run-hook.cmd'), path.join(config.scriptsDir, 'run-hook.cmd'), options.installMethod);

    // 3. Materializar el payload compuesto (using-awm + orquestadores declarados) — ver
    //    writeMaterializedSkill arriba para por que esto ya no es un symlink al SKILL.md crudo.
    const skillDest = path.join(config.scriptsDir, 'using-awm.md');
    writeMaterializedSkill(skillDest, options.registryRoot);

    // 4. Backup settings if it exists
    const backupPath = backupManagedFile(config.settingsPath);

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

    // Misma poda que en codex.ts: restos nuestros apuntando a un AWM_HOME ya borrado.
    // `settings.hooks[eventName]` se reasigna porque el objeto se serializa entero abajo.
    const entries: any[] = settings.hooks[config.eventName]
        .filter((e: unknown) => !isDeadAwmHookEntry(e, config.matcher, 'run-hook.cmd', config.scriptsDir));
    const pruned = settings.hooks[config.eventName].length !== entries.length;
    settings.hooks[config.eventName] = entries;
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
        // Igual que en codex.ts: si la poda saco algo, hay que escribir aunque nuestra
        // entrada ya este identica — si no, la limpieza se calcula y se tira.
        if (!pruned && JSON.stringify(entries[awmEntryIdx]) === JSON.stringify(newEntry)) {
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

function checkSettingsEntry(settingsPath: string, scriptsDir: string, matcher: string, eventName: string): CheckResult {
    if (!fs.existsSync(settingsPath)) {
        return { ok: false, detail: `settings.json not found: ${settingsPath}` };
    }
    let parsed: any;
    try {
        parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    } catch {
        return { ok: false, detail: 'settings.json is not valid JSON' };
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

export function computeClaudeHookStatus(agent: 'claude-code'): HookStatus {
    const config = getSettingsMergeHookConfig(agent);

    const checks = {
        bootstrapSkill: checkFile(path.join(config.scriptsDir, 'using-awm.md')),
        sessionStartScript: checkExecutable(path.join(config.scriptsDir, 'session-start')),
        runHookWrapper: checkExecutable(path.join(config.scriptsDir, 'run-hook.cmd')),
        settingsEntry: checkSettingsEntry(config.settingsPath, config.scriptsDir, config.matcher, config.eventName)
    };

    const allOk = Object.values(checks).every((c) => c.ok);
    const settingsOnlyMissing = !checks.settingsEntry.ok && checks.bootstrapSkill.ok && checks.sessionStartScript.ok && checks.runHookWrapper.ok;

    let overall: HookStatus['overall'];
    if (allOk) overall = 'HEALTHY';
    else if (settingsOnlyMissing) overall = 'NOT_INSTALLED';
    else overall = 'DEGRADED';

    return { overall, checks };
}

export function uninstallClaudeHook(agent: 'claude-code'): UninstallResult {
    const config = getSettingsMergeHookConfig(agent);

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

    const backupPath = backupManagedFile(config.settingsPath);

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

/** Refresh the Claude hook's script/skill files in place (used by resync). Assumes the caller has verified the settings entry is already present. */
export function resyncClaudeHookFiles(config: { scriptsDir: string }, registryRoot: string, method: 'symlink' | 'copy'): void {
    const sourceHooks = path.join(registryRoot, 'hooks');

    fs.mkdirSync(config.scriptsDir, { recursive: true });
    syncExecutable(path.join(sourceHooks, 'session-start'), path.join(config.scriptsDir, 'session-start'), method);
    syncExecutable(path.join(sourceHooks, 'run-hook.cmd'), path.join(config.scriptsDir, 'run-hook.cmd'), method);

    // Re-materializar el payload compuesto igual que `installClaudeHook` (arriba) — NO
    // volver a symlinkear al SKILL.md crudo. Antes este era el segundo escritor del mismo
    // archivo con el symlink-con-fallback-a-copia; si solo `installClaudeHook` se hubiera
    // arreglado y este no, el primer `awm update` posterior a un install correcto habria
    // sobreescrito el payload materializado con un symlink crudo de nuevo — reabriendo el
    // bypass que esto existe para cerrar.
    const skillDest = path.join(config.scriptsDir, 'using-awm.md');
    writeMaterializedSkill(skillDest, registryRoot);
}

/** True when the registry has everything needed to resync the Claude hook files. */
export function claudeResyncSourcesExist(registryRoot: string): boolean {
    const sourceHooks = path.join(registryRoot, 'hooks');
    const sourceSkill = path.join(registryRoot, 'skills/using-awm/SKILL.md');
    return fs.existsSync(path.join(sourceHooks, 'session-start')) &&
        fs.existsSync(path.join(sourceHooks, 'run-hook.cmd')) &&
        fs.existsSync(sourceSkill);
}
