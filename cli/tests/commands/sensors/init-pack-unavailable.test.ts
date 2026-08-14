// `awm sensors init` auto-detects the stack, then reads that pack's defaults out of
// the registry. When the registry has no such pack — a pinned or stale registry, or one
// that simply never shipped it — `readPackDefaults` returned null and the manifest was
// written EMPTY, with no error and no warning:
//
//     $ awm sensors init          # python project, registry predates the python pack
//     ✔ Detected: python (pyproject.toml)
//     ✔ Wrote .awm/sensors.json          ← {"pack":"python","sensors":{}}
//
// Nothing in that output says the quality gate now checks nothing. The operator finds
// out later, from an unrelated command (`awm preflight` exits 1, `awm sensors status`
// reports DEGRADED), and the manifest is by then committed.
//
// `--pack <name>` has always validated against the registry and thrown (assertPackExists).
// Auto-detection reaching the same dead end must not be quieter than the explicit path:
// it now falls back to a pack the registry actually has, and says which pack was missing
// so the operator hears it at the moment the decision is made.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initSensors } from '../../../src/commands/sensors/init';

function mkRegistry(packs: Record<string, unknown>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-packreg-'));
    for (const [name, sensors] of Object.entries(packs)) {
        const dir = path.join(root, 'sensor-packs', name);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ name, sensors }));
    }
    return root;
}

function mkPythonProject(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-packproj-'));
    fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\nname = "x"\n');
    return dir;
}

const GENERIC = { security: { defaultCmd: 'semgrep .', fast: false } };
const PYTHON = { typecheck: { defaultCmd: 'mypy .', fast: true, formatter: 'mypy' } };

describe('awm sensors init — detected pack missing from the registry', () => {
    const made: string[] = [];
    const registry = (packs: Record<string, unknown>) => { const r = mkRegistry(packs); made.push(r); return r; };
    const project = () => { const p = mkPythonProject(); made.push(p); return p; };
    const manifestOf = (dir: string) =>
        JSON.parse(fs.readFileSync(path.join(dir, '.awm', 'sensors.json'), 'utf-8'));

    afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

    it('names the missing pack instead of writing an empty manifest silently', async () => {
        const cwd = project();
        const result = await initSensors({ cwd, registryRoot: registry({ 'js-ts': {}, generic: GENERIC }) });

        expect(result.unavailablePack).toBe('python');
        expect(result.detection.pack).toBe('python'); // what the tree actually is — unchanged
    });

    it('falls back to a pack the registry does have, so the gate still measures something', async () => {
        const cwd = project();
        const result = await initSensors({ cwd, registryRoot: registry({ 'js-ts': {}, generic: GENERIC }) });

        expect(result.manifest.pack).toBe('generic');
        expect(Object.keys(result.manifest.sensors)).toEqual(['security']);
        expect(manifestOf(cwd).pack).toBe('generic');
    });

    it('stays on the detected pack when the registry has no fallback either', async () => {
        // Nothing better exists. The manifest is honestly empty and still says so —
        // preflight's `manifest` check fails on `total === 0` with a registry remedy.
        const cwd = project();
        const result = await initSensors({ cwd, registryRoot: registry({ 'js-ts': {} }) });

        expect(result.unavailablePack).toBe('python');
        expect(result.manifest.pack).toBe('python');
        expect(result.manifest.sensors).toEqual({});
    });

    it('is quiet when the registry does have the detected pack', async () => {
        const cwd = project();
        const result = await initSensors({ cwd, registryRoot: registry({ python: PYTHON, generic: GENERIC }) });

        expect(result.unavailablePack).toBeUndefined();
        expect(result.manifest.pack).toBe('python');
        expect(Object.keys(result.manifest.sensors)).toEqual(['typecheck']);
    });

    it('does not fall back when there is no registry to check against', async () => {
        // No registryRoot means nothing to validate against, the same tolerance
        // `--pack` already has — not evidence that the pack is missing.
        const cwd = project();
        const result = await initSensors({ cwd });

        expect(result.unavailablePack).toBeUndefined();
        expect(result.manifest.pack).toBe('python');
    });

    it('keeps sensors the user already had when falling back', async () => {
        // The fallback must not be a way to lose hand-written configuration.
        const cwd = project();
        fs.mkdirSync(path.join(cwd, '.awm'), { recursive: true });
        fs.writeFileSync(
            path.join(cwd, '.awm', 'sensors.json'),
            JSON.stringify({ pack: 'python', sensors: { test: { cmd: 'pytest -q', fast: false } } }),
        );

        const result = await initSensors({ cwd, registryRoot: registry({ generic: GENERIC }) });

        expect(result.manifest.sensors.test?.cmd).toBe('pytest -q');
        expect(Object.keys(result.manifest.sensors).sort()).toEqual(['security', 'test']);
    });
});
