import crypto from 'crypto';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { materializePortableSensors } from '../../src/commands/sensors/compatibility/materialize';
import { resolvePackSource } from '../../src/commands/sensors/compatibility/pack-source';
import { setSecureFsForTests } from '../../src/commands/sensors/compatibility/safe-file';
import { secureFs } from '../../src/core/secure-fs/native-bridge';

const cliRoot = path.resolve(__dirname, '../..');
const bin = path.join(cliRoot, 'dist/src/index.js');
const fixtureRoot = path.join(cliRoot, 'tests/fixtures/sensor-compatibility');

type Fixture = { root: string; project: string; awmHome: string; registryRoot: string };

function hashTree(root: string): string {
    const hash = crypto.createHash('sha256');
    const walk = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const file = path.join(directory, entry.name);
            hash.update(path.relative(root, file));
            if (entry.isDirectory()) walk(file);
            else if (entry.isFile()) hash.update(fs.readFileSync(file));
        }
    };
    walk(root);
    return hash.digest('hex');
}

function fixture(): Fixture {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-bootstrap-e2e-'));
    const project = path.join(root, 'project');
    const awmHome = path.join(root, 'awm-home');
    const registryRoot = path.join(awmHome, 'registries', 'baseline');
    fs.cpSync(path.join(fixtureRoot, 'project'), project, { recursive: true });
    fs.mkdirSync(path.join(project, 'node_modules', 'eslint'), { recursive: true });
    fs.copyFileSync(path.join(project, 'eslint-tool-package.json'), path.join(project, 'node_modules', 'eslint', 'package.json'));
    fs.mkdirSync(path.dirname(registryRoot), { recursive: true });
    fs.cpSync(path.join(fixtureRoot, 'registry'), registryRoot, { recursive: true });
    fs.writeFileSync(path.join(awmHome, 'registries.json'), JSON.stringify([{ name: 'baseline', remote: 'fixture' }]));
    return { root, project, awmHome, registryRoot };
}

function run(fixture: Fixture, ...args: string[]) {
    return spawnSync(process.execPath, [bin, 'sensors', 'bootstrap', ...args], {
        cwd: fixture.project,
        encoding: 'utf8',
        env: { ...process.env, AWM_HOME: fixture.awmHome, AWM_NO_UPDATE_CHECK: '1' },
    });
}

function v2Manifest(): object {
    return {
        schemaVersion: 2,
        pack: 'js-ts',
        sensors: {
            lint: {
                enabled: true, variantId: 'eslint-10',
                command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
                assets: ['eslint.fixture.mjs'],
                initializedCompatibility: {
                    state: 'certified', reason: 'fixture', variantId: 'eslint-10',
                    toolVersion: '10.4.1', runtimeVersion: '24.0.0', certifiedRange: '>=10 <11', evidence: [],
                },
            },
        },
    };
}

beforeAll(() => {
    if (!fs.existsSync(bin)) throw new Error(`Sensor bootstrap E2E requires the compiled CLI at ${bin}; run npm run build before this test.`);
});

test('compiled bootstrap creates once and the exact second invocation is a byte-stable no-op', () => {
    const subject = fixture();
    try {
        fs.rmSync(path.join(subject.project, '.awm'), { recursive: true, force: true });
        const machineBefore = hashTree(subject.awmHome);
        expect(run(subject, '--mode', 'native-gate', '--reason', 'fixture-gate').status).toBe(0);
        const first = hashTree(subject.project);
        expect(run(subject, '--mode', 'native-gate', '--reason', 'fixture-gate').status).toBe(0);
        expect(hashTree(subject.project)).toBe(first);
        expect(hashTree(subject.awmHome)).toBe(machineBefore);
        expect(JSON.parse(fs.readFileSync(path.join(subject.project, '.awm', 'sensors.json'), 'utf8'))).toEqual({ schemaVersion: 3, mode: 'native-gate', reason: 'fixture-gate' });
    } finally { fs.rmSync(subject.root, { recursive: true, force: true }); }
});

test('compiled project-sensors bootstrap materializes only selected assets and then no-ops', () => {
    const subject = fixture();
    try {
        fs.rmSync(path.join(subject.project, '.awm'), { recursive: true, force: true });
        fs.copyFileSync(path.join(subject.registryRoot, 'sensor-packs', 'js-ts', 'eslint.fixture.mjs'), path.join(subject.project, 'eslint.fixture.mjs'));
        const machineBefore = hashTree(subject.awmHome);
        const result = run(subject, '--mode', 'project-sensors');
        if (result.status !== 0) throw new Error(`project-sensors bootstrap failed: ${result.stdout}\n${result.stderr}`);
        expect(`${result.stdout}${result.stderr}`).toContain('pack=js-ts');
        expect(fs.existsSync(path.join(subject.project, 'eslint.fixture.mjs'))).toBe(true);
        expect(fs.existsSync(path.join(subject.project, 'pack.json'))).toBe(false);
        const first = hashTree(subject.project);
        expect(run(subject, '--mode', 'project-sensors').status).toBe(0);
        expect(hashTree(subject.project)).toBe(first);
        expect(hashTree(subject.awmHome)).toBe(machineBefore);
    } finally { fs.rmSync(subject.root, { recursive: true, force: true }); }
});

test('injected manifest publication failure compensates created assets without changing unrelated project or machine bytes', () => {
    const subject = fixture();
    try {
        fs.rmSync(path.join(subject.project, '.awm'), { recursive: true, force: true });
        const beforePackage = fs.readFileSync(path.join(subject.project, 'package.json'));
        const beforeConfig = fs.readFileSync(path.join(subject.project, 'eslint.config.mjs'));
        const beforeMachine = hashTree(subject.awmHome);
        const source = resolvePackSource('js-ts', { registries: [{ name: 'baseline', remote: 'fixture', contentRoot: subject.registryRoot }] });
        setSecureFsForTests({
            withProjectLease: secureFs.withProjectLease,
            readRegularFile: secureFs.readRegularFile,
            writeProjectTransaction: ((root: string, destination: string, content: Buffer, options: Parameters<typeof secureFs.writeProjectTransaction>[3]) => {
                if (destination === '.awm/sensors.json') throw new Error('injected rename failure');
                secureFs.writeProjectTransaction(root, destination, content, options);
            }) as typeof secureFs.writeProjectTransaction,
            removeObservedProjectFile: secureFs.removeObservedProjectFile,
        });
        expect(() => materializePortableSensors({
            projectRoot: subject.project, pack: 'js-ts', source,
            sensors: { lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.fixture.mjs'], initializedCompatibility: { state: 'certified', reason: 'fixture', variantId: 'eslint-10', toolVersion: '10.4.1', runtimeVersion: '24.0.0', certifiedRange: '>=10 <11', evidence: [] } } },
        })).toThrow('injected rename failure');
        expect(fs.readFileSync(path.join(subject.project, 'package.json'))).toEqual(beforePackage);
        expect(fs.readFileSync(path.join(subject.project, 'eslint.config.mjs'))).toEqual(beforeConfig);
        expect(fs.existsSync(path.join(subject.project, 'eslint.fixture.mjs'))).toBe(false);
        expect(fs.existsSync(path.join(subject.project, '.awm', 'sensors.json'))).toBe(false);
        expect(hashTree(subject.awmHome)).toBe(beforeMachine);
        expect(fs.existsSync(path.join(subject.project, '.awm', 'sensors.json.tmp'))).toBe(false);
    } finally {
        setSecureFsForTests(undefined);
        fs.rmSync(subject.root, { recursive: true, force: true });
    }
});

test('compiled bootstrap migrates v2 once, preserves all non-manifest project bytes, and then no-ops', () => {
    const subject = fixture();
    try {
        const manifest = path.join(subject.project, '.awm', 'sensors.json');
        fs.writeFileSync(manifest, JSON.stringify(v2Manifest(), null, 2) + '\n');
        const machineBefore = hashTree(subject.awmHome);
        const assetBefore = fs.readFileSync(path.join(subject.project, 'eslint.config.mjs'));
        expect(run(subject).status).toBe(0);
        const first = hashTree(subject.project);
        const migrated = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        expect(migrated).toMatchObject({ schemaVersion: 3, mode: 'project-sensors', source: { registry: 'baseline' } });
        expect(migrated).not.toHaveProperty('registryRoot');
        expect(fs.readFileSync(path.join(subject.project, 'eslint.config.mjs'))).toEqual(assetBefore);
        expect(run(subject).status).toBe(0);
        expect(hashTree(subject.project)).toBe(first);
        expect(hashTree(subject.awmHome)).toBe(machineBefore);
    } finally { fs.rmSync(subject.root, { recursive: true, force: true }); }
});
