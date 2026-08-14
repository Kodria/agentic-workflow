import fs from 'fs';
import path from 'path';
import { resolveOnPath } from '../../core/paths';
import { SensorCheck, SensorStatusResult, SensorManifest } from './types';
import { parseSensorManifest } from './compatibility/manifest';
import { resolveLiveCompatibility } from './compatibility/live';

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
        return { ok: false, detail: `missing config: ${cfg}` };
    }
    return null;
}

/**
 * Verify a sensor command can actually run — not just that `npx` exists.
 * - `npx <tool>`: the tool MUST be installed locally (node_modules/.bin). Otherwise
 *   `npx` would fetch a remote package at run time (dependency-confusion risk) and
 *   the sensor would fail. A green status here would be a lie.
 * - other binaries: must resolve on PATH (`where` on win32, `command -v` elsewhere).
 * - any `--config <file>` referenced must exist.
 */
function checkCmd(cmd: string, cwd: string): SensorCheck {
    const parts = cmd.split(/\s+/).filter(Boolean);
    const bin = parts[0];

    if (bin === 'npx') {
        const tool = npxTool(parts);
        if (!tool) return { ok: false, detail: 'npx without a tool specified' };
        const localBin = path.join(cwd, 'node_modules', '.bin', tool);
        if (!fs.existsSync(localBin)) {
            return {
                ok: false,
                detail: `${tool} not installed locally (npx would download a remote package) — add it to devDependencies`,
            };
        }
        return configCheck(parts, cwd) ?? { ok: true, detail: `${tool} (node_modules/.bin)` };
    }

    if (!resolveOnPath(bin)) {
        return { ok: false, detail: `${bin} not found in PATH` };
    }
    return configCheck(parts, cwd) ?? { ok: true, detail: bin };
}

export async function computeSensorStatus(cwd: string = process.cwd()): Promise<SensorStatusResult> {
    const manifestPath = path.join(cwd, '.awm', 'sensors.json');
    if (!fs.existsSync(manifestPath)) {
        return { overall: 'NOT_CONFIGURED', pack: null, checks: {} };
    }

    let manifest: SensorManifest;
    try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const parsed = parseSensorManifest(raw, manifestPath);
        if (parsed.kind === 'v2') {
            const checks: Record<string, SensorCheck> = {};
            let live: Awaited<ReturnType<typeof resolveLiveCompatibility>>;
            try {
                live = await resolveLiveCompatibility(cwd, parsed.pack.pack, parsed.pack.registryRoot, { packSelection: parsed.pack.packSelection });
            } catch (error) {
                const detail = `compatibility revalidation failed: ${error instanceof Error ? error.message : String(error)}`;
                for (const [name, sensor] of Object.entries(parsed.pack.sensors)) {
                    checks[name] = sensor.enabled === false ? { ok: true, detail: 'disabled' } : { ok: false, detail };
                }
                return { overall: 'DEGRADED', pack: parsed.pack.pack, checks };
            }
            for (const [name, sensor] of Object.entries(parsed.pack.sensors)) {
                const state = live.sensors[name];
                checks[name] = sensor.enabled === false
                    ? { ok: true, detail: 'disabled' }
                    : !state
                        ? { ok: false, detail: 'variant-drift: sensor no longer exists in the live pack; run `awm sensors init`' }
                        : state.variantId !== sensor.variantId
                            ? { ok: false, detail: `variant-drift: manifest ${sensor.variantId}, live ${state.variantId ?? 'none'}; run \`awm sensors init\`` }
                    : state.state === 'certified'
                        ? { ok: true, detail: `certified (${state.variantId})` }
                        : state.state === 'not-applicable'
                            ? { ok: true, detail: 'not applicable' }
                            : { ok: false, detail: `${state.state}: ${state.reason}` };
            }
            return { overall: Object.keys(checks).length > 0 && Object.values(checks).every(check => check.ok) ? 'HEALTHY' : 'DEGRADED', pack: parsed.pack.pack, checks };
        }
        manifest = parsed.pack;
    } catch {
        // Preserve the historic diagnostic path for a hand-edited legacy manifest:
        // malformed v2 is fail-closed, while a legacy `sensors:null` is surfaced as
        // degraded rather than crashing the status command.
        try {
            const raw: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
            if (raw && typeof raw === 'object' && !Array.isArray(raw) && !('schemaVersion' in raw) && typeof (raw as any).pack === 'string') {
                return { overall: 'DEGRADED', pack: (raw as any).pack, checks: {} };
            }
        } catch { /* malformed JSON is not configured */ }
        return { overall: 'NOT_CONFIGURED', pack: null, checks: {} };
    }

    const checks: Record<string, SensorCheck> = {};
    for (const [name, config] of Object.entries(manifest.sensors ?? {})) {
        if (config.enabled === false) { checks[name] = { ok: true, detail: 'disabled' }; continue; }
        if (!config.cmd) { checks[name] = { ok: false, detail: 'no cmd configured' }; continue; }
        checks[name] = checkCmd(config.cmd, cwd);
    }

    // `Object.values({}).every(...)` is vacuously true — a manifest with zero sensor
    // entries (the registry had no pack.json for this stack; see init.ts) must not read
    // as HEALTHY just because there was nothing to fail. Same false-green `checkManifest`
    // guards against in preflight.
    if (Object.keys(manifest.sensors ?? {}).length === 0) {
        return { overall: 'DEGRADED', pack: manifest.pack, checks };
    }
    // A legacy manifest may be operational (the checks are still useful), but it
    // has no versioned/structured contract and must never present as certified.
    return { overall: 'DEGRADED', pack: manifest.pack, checks };
}
