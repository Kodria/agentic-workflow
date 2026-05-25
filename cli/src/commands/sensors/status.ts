import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { SensorCheck, SensorStatusResult, SensorManifest } from './types';

function checkBinary(cmd: string): SensorCheck {
    const bin = cmd.split(' ')[0];
    const probe = cmd.startsWith('npx ') ? `which npx` : `which ${bin}`;
    try {
        execSync(probe, { stdio: 'pipe' });
        return { ok: true, detail: cmd.startsWith('npx ') ? `${bin} (via npx)` : bin };
    } catch {
        return { ok: false, detail: `${bin} not found in PATH` };
    }
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
        checks[name] = checkBinary(config.cmd);
    }

    const allOk = Object.values(checks).every(c => c.ok);
    return { overall: allOk ? 'HEALTHY' : 'DEGRADED', pack: manifest.pack, checks };
}
