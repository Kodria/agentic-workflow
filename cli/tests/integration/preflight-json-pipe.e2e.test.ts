import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const cliRoot = path.resolve(__dirname, '../..');
const bin = path.join(cliRoot, 'dist', 'src', 'index.js');

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

test.each([
    ['plain preflight', ['preflight']],
    ['JSON preflight', ['preflight', '--json']],
    ['JSON sensor-verification preflight', ['preflight', '--verify-sensors', '--json']],
] as const)('%s never starts the passive update worker', async (_name, args) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-preflight-update-'));
    const project = path.join(root, 'project');
    const awmHome = path.join(root, 'awm-home');
    const fetchStub = path.join(root, 'fetch-stub.cjs');
    const updateCache = path.join(awmHome, 'update-check.json');
    // The worker inherits NODE_OPTIONS. A deterministic immediate response makes a
    // pre-fix worker write observable without relying on the network or a timeout.
    fs.writeFileSync(fetchStub, "global.fetch = async () => ({ ok: true, json: async () => ({ version: '999.0.0' }) });\n");
    fs.mkdirSync(project, { recursive: true });

    try {
        const result = spawnSync(process.execPath, [bin, ...args], {
            cwd: project,
            encoding: 'utf8',
            env: {
                ...process.env,
                AWM_HOME: awmHome,
                AWM_NO_UPDATE_CHECK: '',
                NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require=${fetchStub}`.trim(),
            },
        });

        expect(result.status).toBe(1);
        // A spawned worker using the deterministic response above writes well inside
        // this window; the delay also verifies it was never merely deferred.
        await wait(1_000);
        expect(fs.existsSync(updateCache)).toBe(false);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('preserves actionable no-manifest preflight JSON when verify-sensors is piped', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-preflight-pipe-'));
    try {
        const result = spawnSync(process.execPath, [bin, 'preflight', '--verify-sensors', '--json'], {
            cwd: project,
            encoding: 'utf8',
            env: { ...process.env, AWM_HOME: path.join(project, 'awm-home'), AWM_NO_UPDATE_CHECK: '1' },
        });
        expect(result.status).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({
            status: 'not_configured',
            checks: expect.arrayContaining([expect.objectContaining({
                id: 'sensors-execution', ok: false,
                detail: 'sensor verdict was not_certified; no sensor established an empirical pass',
                remedy: expect.stringContaining('awm sensors init'),
            })]),
        });
    } finally {
        fs.rmSync(project, { recursive: true, force: true });
    }
});

function writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function hashTree(root: string): string {
    const hash = crypto.createHash('sha256');
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const file = path.join(dir, entry.name);
            hash.update(path.relative(root, file));
            if (entry.isDirectory()) walk(file);
            else if (entry.isFile()) hash.update(fs.readFileSync(file));
        }
    };
    walk(root);
    return hash.digest('hex');
}

test('verify-sensors degrades parseably for a v2 sensor that exits 2 without findings and does not write the project', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-preflight-verify-'));
    const project = path.join(root, 'project');
    const awmHome = path.join(root, 'awm-home');
    const registry = path.join(awmHome, 'registries', 'baseline');
    try {
        fs.mkdirSync(project, { recursive: true });
        fs.writeFileSync(path.join(project, 'AGENTS.md'), '# context\n', { encoding: 'utf8', flag: 'w' });
        writeJson(path.join(project, 'package.json'), { name: 'preflight-verify-fixture', private: true });
        writeJson(path.join(project, 'node_modules', 'fixture-sensor', 'package.json'), { name: 'fixture-sensor', version: '1.0.0' });
        fs.writeFileSync(path.join(project, 'fixture-sensor.config.mjs'), 'export default {};\n');
        fs.writeFileSync(path.join(project, 'fixture-sensor.mjs'), 'process.exit(2);\n');
        writeJson(path.join(registry, 'sensor-packs', 'fixture', 'pack.json'), {
            schemaVersion: 2, name: 'fixture', description: 'preflight exit-2 fixture', detects: ['package.json'],
            sensors: { lint: { applicability: { allFiles: ['package.json'] }, variants: [{
                id: 'fixture-v1', priority: 100,
                requirements: { tool: 'fixture-sensor', toolRange: '>=1 <2', runtime: 'node', runtimeRange: '>=20', configFiles: ['fixture-sensor.config.mjs'] },
                certifiedRange: '>=1 <2', command: { executable: 'node', resolution: 'path', args: ['fixture-sensor.mjs'] },
                assets: ['fixture-sensor.config.mjs'], formatter: 'generic', probe: { kind: 'config-present' },
            }] } },
            coverage: { schemaVersion: 1, classes: {
                'fixture-output': {
                    description: 'fixture output', detectors: [{ sensor: 'lint' }],
                    remedy: { summary: 'run fixture', command: 'awm sensors init --pack fixture' },
                },
            } },
        });
        writeJson(path.join(awmHome, 'registries.json'), [{ name: 'baseline', remote: 'fixture' }]);
        writeJson(path.join(project, '.awm', 'sensors.json'), {
            schemaVersion: 2, pack: 'fixture', packSelection: 'explicit', sensors: { lint: {
                enabled: true, fast: true, variantId: 'fixture-v1', command: { executable: 'node', resolution: 'path', args: ['fixture-sensor.mjs'] }, assets: ['fixture-sensor.config.mjs'],
                initializedCompatibility: { state: 'certified', reason: 'fixture', variantId: 'fixture-v1', toolVersion: '1.0.0', runtimeVersion: process.versions.node, certifiedRange: '>=1 <2', evidence: [] },
            } },
        });
        const before = hashTree(project);
        const result = spawnSync(process.execPath, [bin, 'preflight', '--verify-sensors', '--json', '--cwd', project], {
            cwd: project, encoding: 'utf8', env: { ...process.env, AWM_HOME: awmHome, AWM_NO_UPDATE_CHECK: '1' },
        });

        expect(result.status).toBe(1);
        expect(JSON.parse(result.stdout)).toMatchObject({
            status: 'degraded',
            checks: expect.arrayContaining([expect.objectContaining({ id: 'sensors-execution', ok: false, detail: expect.stringMatching(/lint.*exit 2/i) })]),
        });
        expect(hashTree(project)).toBe(before);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
