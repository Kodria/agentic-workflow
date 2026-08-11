import crypto from 'crypto';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const cliDir = path.resolve(__dirname, '../..');
const bin = path.join(cliDir, 'dist/src/index.js');
const fixture = path.join(cliDir, 'tests/fixtures/sensor-coverage/js-ts-gap');
const registryFixture = path.join(cliDir, 'tests/fixtures/sensor-coverage/registry');

const hashTree = (root: string): string => {
    const hash = crypto.createHash('sha256');
    const walk = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const file = path.join(directory, entry.name);
            hash.update(path.relative(root, file));
            if (entry.isDirectory()) walk(file);
            else if (entry.isFile()) hash.update(fs.readFileSync(file));
            else hash.update(`link:${fs.readlinkSync(file)}`);
        }
    };
    walk(root);
    return hash.digest('hex');
};

beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { cwd: cliDir, stdio: 'pipe' });
});

test('js-ts gap fixture tracks the manifest copied into the coverage project', () => {
    const manifest = path.join(fixture, '.awm', 'sensors.json');
    expect(fs.existsSync(manifest)).toBe(true);
    expect(JSON.parse(fs.readFileSync(manifest, 'utf8'))).toMatchObject({
        sensors: expect.any(Object),
    });
    expect(execFileSync('git', ['ls-files', '--error-unmatch', 'tests/fixtures/sensor-coverage/js-ts-gap/.awm/sensors.json'], {
        cwd: cliDir, encoding: 'utf8',
    }).trim()).toBe('tests/fixtures/sensor-coverage/js-ts-gap/.awm/sensors.json');
});

function runWithFixture(mutatePack?: (pack: Record<string, unknown>) => void) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-coverage-e2e-'));
    const project = path.join(tmp, 'project');
    const awmHome = path.join(tmp, 'awm-home');
    const registry = path.join(awmHome, 'registries', 'baseline');
    fs.cpSync(fixture, project, { recursive: true });
    fs.mkdirSync(path.dirname(registry), { recursive: true });
    fs.cpSync(registryFixture, registry, { recursive: true });
    fs.writeFileSync(path.join(awmHome, 'registries.json'), JSON.stringify([{ name: 'baseline', remote: 'fixture' }]));
    if (mutatePack) {
        const packPath = path.join(registry, 'sensor-packs/js-ts/pack.json');
        const pack = JSON.parse(fs.readFileSync(packPath, 'utf8')) as Record<string, unknown>;
        mutatePack(pack);
        fs.writeFileSync(packPath, JSON.stringify(pack));
    }
    return { tmp, project, awmHome };
}

test('compiled CLI reports formatter/style gaps and changes no bytes (RF-1.1, RF-1.4)', () => {
    const { tmp, project, awmHome } = runWithFixture();
    try {
        const before = [hashTree(project), hashTree(awmHome)];
        const stdout = execFileSync(process.execPath, [bin, 'sensors', 'coverage', '--json'], {
            cwd: project, encoding: 'utf8', env: { ...process.env, AWM_HOME: awmHome, AWM_NO_UPDATE_CHECK: '1' },
        });
        const report = JSON.parse(stdout);
        expect(report.static.classes).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'formatting', status: 'missing' }),
            expect.objectContaining({ id: 'project-style-conventions', status: 'missing' }),
        ]));
        expect([hashTree(project), hashTree(awmHome)]).toEqual(before);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('informative states exit zero; malformed contract exits non-zero (R2.7, R2.9)', () => {
    const run = (mutatePack: (pack: Record<string, unknown>) => void) => {
        const { tmp, project, awmHome } = runWithFixture(mutatePack);
        try {
            return spawnSync(process.execPath, [bin, 'sensors', 'coverage', '--json'], {
                cwd: project, encoding: 'utf8', env: { ...process.env, AWM_HOME: awmHome, AWM_NO_UPDATE_CHECK: '1' },
            });
        } finally {
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    };
    const gaps = run(() => undefined);
    const noReference = run((pack) => { delete pack.coverage; });
    const malformed = run((pack) => { (pack.coverage as { schemaVersion: number }).schemaVersion = 2; });
    expect(gaps.status).toBe(0);
    expect(JSON.parse(gaps.stdout ?? '')).toMatchObject({ overall: 'gaps' });
    expect(noReference.status).toBe(0);
    expect(JSON.parse(noReference.stdout ?? '')).toMatchObject({ static: { reason: 'no_reference' } });
    expect(malformed.status).toBe(1);
    expect(`${malformed.stdout ?? ''}${malformed.stderr ?? ''}`).toContain('schemaVersion must be 1');
});
