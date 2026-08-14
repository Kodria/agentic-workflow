import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const cliDir = path.resolve(__dirname, '../..');
const bin = path.join(cliDir, 'dist/src/index.js');

type Fixture = { root: string; project: string; awmHome: string; registryRoot: string; literal: string };

function writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

/**
 * This is deliberately an argument which changes meaning under a shell on both
 * POSIX and cmd.exe. The controlled Node tool records argv before the possible
 * injected command can run, while the injected command would create the marker.
 * A shell:true regression must therefore either alter argv or create the marker.
 */
const shellSensitiveLiteral = '--literal=preserve-this&node -e "require(\'fs\').writeFileSync(\'structured-shell-injection\', \'unexpected\')"';

function createFixture(): Fixture {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-structured-run-'));
    const project = path.join(root, 'project');
    const awmHome = path.join(root, 'awm-home');
    const registryRoot = path.join(awmHome, 'registries', 'baseline');
    const literal = shellSensitiveLiteral;

    writeJson(path.join(project, 'package.json'), { name: 'structured-run-fixture', private: true });
    // Local metadata is the compatibility evidence. It is not a tool found in a
    // global installation, so init and run must keep resolving this fixture's pack.
    writeJson(path.join(project, 'node_modules', 'fixture-sensor', 'package.json'), {
        name: 'fixture-sensor', version: '1.0.0',
    });
    fs.writeFileSync(path.join(project, 'fixture-sensor.config.mjs'), 'export default {};\n');
    fs.writeFileSync(path.join(project, 'fixture-sensor.mjs'), [
        "import fs from 'fs';",
        "fs.writeFileSync('structured-argv.json', JSON.stringify(process.argv.slice(2)));",
    ].join('\n'));

    writeJson(path.join(registryRoot, 'sensor-packs', 'fixture', 'pack.json'), {
        schemaVersion: 2,
        name: 'fixture',
        description: 'compiled structured-run fixture',
        detects: ['package.json'],
        sensors: {
            structured: {
                applicability: { allFiles: ['package.json'] },
                fast: true,
                variants: [{
                    id: 'fixture-v1', priority: 100,
                    requirements: {
                        tool: 'fixture-sensor', toolRange: '>=1 <2',
                        runtime: 'node', runtimeRange: '>=20', configFiles: ['fixture-sensor.config.mjs'],
                    },
                    certifiedRange: '>=1 <2',
                    // `node` is resolved from the process environment, but the actual
                    // executable payload is the fixture-local script. Keeping the
                    // literal as one argv element proves no shell parses it.
                    command: { executable: 'node', resolution: 'path', args: ['fixture-sensor.mjs', literal] },
                    assets: ['fixture-sensor.config.mjs'], formatter: 'generic', probe: { kind: 'config-present' },
                }],
            },
        },
        coverage: {
            schemaVersion: 1,
            classes: {
                'fixture-output': {
                    description: 'fixture structured output', detectors: [{ sensor: 'structured' }],
                    remedy: { summary: 'run the fixture sensor', command: 'awm sensors init --pack fixture' },
                },
            },
        },
    });
    writeJson(path.join(awmHome, 'registries.json'), [{ name: 'baseline', remote: 'fixture' }]);
    return { root, project, awmHome, registryRoot, literal };
}

function runCli(fixture: Fixture, ...args: string[]) {
    return spawnSync(process.execPath, [bin, 'sensors', ...args], {
        cwd: fixture.project,
        encoding: 'utf8',
        env: { ...process.env, AWM_HOME: fixture.awmHome, AWM_NO_UPDATE_CHECK: '1' },
    });
}

beforeAll(() => {
    if (!fs.existsSync(bin)) throw new Error(`Structured sensor E2E requires the compiled CLI at ${bin}; run npm run build before this test.`);
});

test('compiled sensors run materializes a v2 registry command and passes its literal argv without a shell', () => {
    const fixture = createFixture();
    try {
        const initialized = runCli(fixture, 'init', '--registry-root', fixture.registryRoot, '--pack', 'fixture', '--no-configure');
        if (initialized.status !== 0) throw new Error(`init failed: ${initialized.stdout ?? ''}\n${initialized.stderr ?? ''}`);
        const manifest = JSON.parse(fs.readFileSync(path.join(fixture.project, '.awm', 'sensors.json'), 'utf8'));
        expect(manifest).toMatchObject({
            schemaVersion: 2,
            pack: 'fixture',
            sensors: { structured: { variantId: 'fixture-v1', command: { executable: 'node', resolution: 'path', args: ['fixture-sensor.mjs', fixture.literal] } } },
        });

        const result = runCli(fixture, 'run', '--fast');
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout ?? '')).toMatchObject({
            overall: 'pass', sensors: [expect.objectContaining({ name: 'structured', status: 'pass' })],
        });
        expect(JSON.parse(fs.readFileSync(path.join(fixture.project, 'structured-argv.json'), 'utf8'))).toEqual([fixture.literal]);
        // A shell:true mutation executes the trailing `& node -e ...` (or fails to
        // preserve argv); this sentinel is the side-effect half of the regression.
        expect(fs.existsSync(path.join(fixture.project, 'structured-shell-injection'))).toBe(false);
    } finally {
        fs.rmSync(fixture.root, { recursive: true, force: true });
    }
});
