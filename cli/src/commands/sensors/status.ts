import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { SensorCheck, SensorStatusResult, SensorManifest } from './types';

/** First non-flag token after `npx` — the tool the command actually runs. */
function npxTool(parts: string[]): string | undefined {
    for (let i = 1; i < parts.length; i++) {
        if (!parts[i].startsWith('-')) return parts[i];
    }
    return undefined;
}

/** If the command references `--config <file>`, that file must exist in the repo. */
function configCheck(parts: string[], cwd: string): SensorCheck | null {
    const i = parts.indexOf('--config');
    const cfg = i !== -1 ? parts[i + 1] : undefined;
    if (cfg && !fs.existsSync(path.join(cwd, cfg))) {
        return { ok: false, detail: `config faltante: ${cfg}` };
    }
    return null;
}

/**
 * Verify a sensor command can actually run — not just that `npx` exists.
 * - `npx <tool>`: the tool MUST be installed locally (node_modules/.bin). Otherwise
 *   `npx` would fetch a remote package at run time (dependency-confusion risk) and
 *   the sensor would fail. A green status here would be a lie.
 * - other binaries: must resolve on PATH (`which`).
 * - any `--config <file>` referenced must exist.
 */
function checkCmd(cmd: string, cwd: string): SensorCheck {
    const parts = cmd.split(/\s+/).filter(Boolean);
    const bin = parts[0];

    if (bin === 'npx') {
        const tool = npxTool(parts);
        if (!tool) return { ok: false, detail: 'npx sin tool especificada' };
        const localBin = path.join(cwd, 'node_modules', '.bin', tool);
        if (!fs.existsSync(localBin)) {
            return {
                ok: false,
                detail: `${tool} no instalada localmente (npx bajaría un paquete remoto) — agregala a devDependencies`,
            };
        }
        return configCheck(parts, cwd) ?? { ok: true, detail: `${tool} (node_modules/.bin)` };
    }

    try {
        execSync(`which ${bin}`, { stdio: 'pipe' });
    } catch {
        return { ok: false, detail: `${bin} not found in PATH` };
    }
    return configCheck(parts, cwd) ?? { ok: true, detail: bin };
}

export function computeSensorStatus(cwd: string = process.cwd()): SensorStatusResult {
    const manifestPath = path.join(cwd, '.awm', 'sensors.json');
    if (!fs.existsSync(manifestPath)) {
        return { overall: 'NOT_CONFIGURED', pack: null, checks: {} };
    }

    let manifest: SensorManifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch {
        return { overall: 'NOT_CONFIGURED', pack: null, checks: {} };
    }

    const checks: Record<string, SensorCheck> = {};
    for (const [name, config] of Object.entries(manifest.sensors)) {
        if (config.enabled === false) { checks[name] = { ok: true, detail: 'disabled' }; continue; }
        if (!config.cmd) { checks[name] = { ok: false, detail: 'no cmd configured' }; continue; }
        checks[name] = checkCmd(config.cmd, cwd);
    }

    const allOk = Object.values(checks).every(c => c.ok);
    return { overall: allOk ? 'HEALTHY' : 'DEGRADED', pack: manifest.pack, checks };
}
