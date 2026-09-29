import fs from 'fs';
import path from 'path';
import { awmHome } from '../../core/paths';
import {
    CURSOR_REANCHOR_MAX_BYTES,
    CURSOR_REANCHOR_PIN,
    CURSOR_SESSION_START_MAX_BYTES,
    CURSOR_SESSION_START_PIN,
} from '../../core/cursor-budgets';

/**
 * The feedforward context budget.
 *
 * `AGENTS.md`, `CONSTITUTION.md` and `CLAUDE.md` are injected into EVERY agent session
 * before a single line of code is read, so their size is a per-session tax paid
 * forever. They grow because curing a lesson is an append and pruning one is a
 * judgement call nobody is forced to make.
 *
 * Prose does not hold this line. Measured on a real repo, `AGENTS.md` went 73KB → 141KB
 * across 45 revisions and never shrank once, while `harness-retro` already carried an
 * explicit "merge and prune, never append raw" rule. Adding a second copy of an ignored
 * rule has no expected effect, so this measures instead.
 *
 * It does NOT forbid growth — it makes growth deliberate. First check pins the current
 * total; later checks report when the files have grown past it. The ways out are pruning
 * back under, or raising `maxBytes` in a committed diff a human reviews.
 *
 * **Where this runs matters as much as what it measures.** It belongs at the last moment
 * a human is guaranteed to be present — the pre-handoff gate at the end of
 * `writing-plans`, before execution is handed to subagents. Wired into `awm sensors run`
 * instead, it would fire during unattended overnight runs and strand the very PR the
 * user came back expecting. Hence a command, not a sensor.
 */

/** Injected into every session by the AWM session hook / context contract. */
export const DEFAULT_FILES = ['AGENTS.md', 'CONSTITUTION.md', 'CLAUDE.md'];

export const CONFIG_FILE = path.join('.awm', 'context-budget.json');

export type BudgetConfig = {
    files: string[];
    maxBytes: number;
    /** Optional Cursor hook payload pins (Plan B R5). */
    [CURSOR_SESSION_START_PIN]?: number;
    [CURSOR_REANCHOR_PIN]?: number;
};

export type BudgetReport = {
    /** 'pinned' on the first check; 'within' under budget; 'over' past it;
     *  'unmeasurable' cuando NINGUNO de los archivos existe todavia. */
    status: 'pinned' | 'within' | 'over' | 'unmeasurable';
    totalBytes: number;
    maxBytes: number;
    /** Per-file sizes, in the order declared. Absent files are omitted. */
    breakdown: { file: string; bytes: number }[];
    /** Cursor hook pin comparison when hooks are installed; omitted when absent. */
    cursorHooks?: {
        status: 'within' | 'over' | 'absent';
        sessionStartMaxBytes: number;
        reanchorMaxBytes: number;
        observedSessionStartMaxBytes: number | null;
        observedReanchorMaxBytes: number | null;
    };
};

/** Rough but stable: ~4 bytes per token for prose. Reporting only — never a gate input. */
export function estimateTokens(bytes: number): number {
    return Math.round(bytes / 4 / 1000);
}

export function measure(cwd: string, files: string[]): { total: number; breakdown: { file: string; bytes: number }[] } {
    const breakdown: { file: string; bytes: number }[] = [];
    let total = 0;
    for (const f of files) {
        let s: fs.Stats;
        try {
            s = fs.statSync(path.join(cwd, f));
        } catch {
            continue;   // a repo need not have all three
        }
        if (!s.isFile()) continue;
        total += s.size;
        breakdown.push({ file: f, bytes: s.size });
    }
    return { total, breakdown };
}

/**
 * Read the pinned budget. A malformed or partial config returns null so the caller
 * re-pins rather than treating an unreadable budget as an absent limit — the quiet
 * direction of wrong, where the check silently stops checking.
 */
export function readConfig(cwd: string): BudgetConfig | null {
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(cwd, CONFIG_FILE), 'utf-8'));
        if (typeof raw.maxBytes !== 'number' || !Number.isFinite(raw.maxBytes)) return null;
        const config: BudgetConfig = {
            files: Array.isArray(raw.files) && raw.files.length ? raw.files : DEFAULT_FILES,
            maxBytes: raw.maxBytes,
        };
        if (typeof raw[CURSOR_SESSION_START_PIN] === 'number' && Number.isFinite(raw[CURSOR_SESSION_START_PIN])) {
            config[CURSOR_SESSION_START_PIN] = raw[CURSOR_SESSION_START_PIN];
        }
        if (typeof raw[CURSOR_REANCHOR_PIN] === 'number' && Number.isFinite(raw[CURSOR_REANCHOR_PIN])) {
            config[CURSOR_REANCHOR_PIN] = raw[CURSOR_REANCHOR_PIN];
        }
        return config;
    } catch {
        return null;
    }
}

/** Read MAX_*_BYTES assignments from an installed Cursor session-start script. */
export function readCursorHookByteCaps(scriptPath: string): { session: number | null; reanchor: number | null } {
    if (!fs.existsSync(scriptPath)) return { session: null, reanchor: null };
    const text = fs.readFileSync(scriptPath, 'utf8');
    const session = /MAX_SESSION_BYTES\s*=\s*(\d+)\s*\*\s*(\d+)/.exec(text);
    const reanchor = /MAX_REANCHOR_BYTES\s*=\s*(\d+)\s*\*\s*(\d+)/.exec(text);
    return {
        session: session ? Number(session[1]) * Number(session[2]) : null,
        reanchor: reanchor ? Number(reanchor[1]) * Number(reanchor[2]) : null,
    };
}

export function evaluateCursorHookBudgets(config: BudgetConfig | null): BudgetReport['cursorHooks'] {
    const scriptPath = path.join(awmHome(), 'hooks/cursor/session-start');
    if (!fs.existsSync(scriptPath)) {
        return undefined; // unmeasurable / absent — do not fail
    }
    const pinSession = config?.[CURSOR_SESSION_START_PIN] ?? CURSOR_SESSION_START_MAX_BYTES;
    const pinReanchor = config?.[CURSOR_REANCHOR_PIN] ?? CURSOR_REANCHOR_MAX_BYTES;
    const observed = readCursorHookByteCaps(scriptPath);
    const sessionOk = observed.session === null || observed.session <= pinSession;
    const reanchorOk = observed.reanchor === null || observed.reanchor <= pinReanchor;
    const constantsOk = CURSOR_SESSION_START_MAX_BYTES <= pinSession && CURSOR_REANCHOR_MAX_BYTES <= pinReanchor;
    return {
        status: sessionOk && reanchorOk && constantsOk ? 'within' : 'over',
        sessionStartMaxBytes: pinSession,
        reanchorMaxBytes: pinReanchor,
        observedSessionStartMaxBytes: observed.session,
        observedReanchorMaxBytes: observed.reanchor,
    };
}

export function writeConfig(cwd: string, config: BudgetConfig): void {
    fs.mkdirSync(path.join(cwd, '.awm'), { recursive: true });
    const body = {
        _comment: 'Context budget for files injected into every agent session. Raising maxBytes '
            + 'is allowed but must be a deliberate, reviewed change — see writing-plans, '
            + 'Context Budget Gate.',
        ...config,
    };
    fs.writeFileSync(path.join(cwd, CONFIG_FILE), JSON.stringify(body, null, 2) + '\n', 'utf-8');
}

/**
 * Measure the injected context against the pinned budget.
 *
 * On the first check there is nothing to compare against, so the current total is
 * pinned and the result is `pinned`. Pinning rather than failing means adopting this
 * never blocks a repo that is already large — it only stops it getting larger.
 */
export function checkBudget(cwd: string): BudgetReport {
    const config = readConfig(cwd);
    const cursorHooks = evaluateCursorHookBudgets(config);
    if (!config) {
        const { total, breakdown } = measure(cwd, DEFAULT_FILES);
        // Fijar sobre CERO archivos es una trampa, no una linea base.
        //
        // En un proyecto recien inicializado ninguno de los tres existe todavia: los
        // escribe una sesion de agente, y `awm init` los reporta como pasos `pending`.
        // El 0KB no es un error de medicion — no hay nada que medir. Pero dejar
        // `maxBytes: 0` en disco hace que la corrida SIGUIENTE, apenas el agente escribe
        // AGENTS.md (el flujo documentado), reporte "excedido". Una alarma que siempre
        // suena se aprende a ignorar, y ahi se pierde el gate entero.
        //
        // Se reporta y NO se escribe config: el proximo run, ya con contexto, fija bien.
        if (breakdown.length === 0) {
            return { status: 'unmeasurable', totalBytes: 0, maxBytes: 0, breakdown, ...(cursorHooks ? { cursorHooks } : {}) };
        }
        writeConfig(cwd, { files: DEFAULT_FILES, maxBytes: total });
        return { status: 'pinned', totalBytes: total, maxBytes: total, breakdown, ...(cursorHooks ? { cursorHooks } : {}) };
    }
    const { total, breakdown } = measure(cwd, config.files);
    const fileStatus = total > config.maxBytes ? 'over' : 'within';
    const status = fileStatus === 'over' || cursorHooks?.status === 'over' ? 'over' : fileStatus;
    return {
        status,
        totalBytes: total,
        maxBytes: config.maxBytes,
        breakdown,
        ...(cursorHooks ? { cursorHooks } : {}),
    };
}
