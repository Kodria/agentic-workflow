import fs from 'fs';
import path from 'path';
import { AgentTarget, getHookConfig } from '../../providers';

export type CheckResult = {
    ok: boolean;
    detail: string;
};

export type HookStatus = {
    overall: 'HEALTHY' | 'DEGRADED' | 'NOT_INSTALLED';
    checks: {
        bootstrapSkill: CheckResult;
        sessionStartScript: CheckResult;
        runHookWrapper: CheckResult;
        settingsEntry: CheckResult;
    };
};

function checkExecutable(file: string): CheckResult {
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

function checkFile(file: string): CheckResult {
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

export function computeHookStatus(agent: AgentTarget): HookStatus {
    const config = getHookConfig(agent);
    if (!config) {
        throw new Error(`hooks not supported for agent target: ${agent}`);
    }

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
