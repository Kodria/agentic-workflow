import crypto from 'crypto';
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const cliDir = path.resolve(__dirname, '../..');
const bin = path.join(cliDir, 'dist/src/index.js');
const fixture = path.join(cliDir, 'tests/fixtures/sensor-coverage/js-ts-gap');
const registryFixture = path.join(cliDir, 'tests/fixtures/sensor-coverage/registry');
const noFollowUnavailableOnNativeWindows = process.platform === 'win32'
    && typeof fs.constants.O_NOFOLLOW !== 'number';
const testWithNoFollow = noFollowUnavailableOnNativeWindows ? test.skip : test;

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
    if (!fs.existsSync(bin)) {
        throw new Error(`Coverage E2E requires the compiled CLI at ${bin}; run npm run build before this test.`);
    }
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

test('compiled CLI reports static and read-only empirical coverage without leaking ledger text (R5.6, R5.10)', () => {
    const { tmp, project, awmHome } = runWithFixture();
    try {
        const before = [hashTree(project), hashTree(awmHome)];
        const result = spawnSync(process.execPath, [bin, 'sensors', 'coverage', '--json'], {
            cwd: project, encoding: 'utf8', env: { ...process.env, AWM_HOME: awmHome, AWM_NO_UPDATE_CHECK: '1' },
        });
        if (noFollowUnavailableOnNativeWindows) {
            expect(result.status).toBe(1);
            expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).toContain('platform cannot guarantee no symlink dereference');
        } else {
            expect(result.status).toBe(0);
            const report = JSON.parse(result.stdout ?? '');
            expect(report.static.classes).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: 'formatting', status: 'unverifiable' }),
                expect.objectContaining({ id: 'project-style-conventions', status: 'unverifiable' }),
            ]));
            expect(report).toMatchObject({ schemaVersion: 2, empirical: {
                status: 'partial', classes: [expect.objectContaining({ defectClass: 'lint-errors', occurrences: 2, recurrent: true })],
                unclassified: { occurrences: 1 },
            } });
            expect(result.stdout).not.toContain('fixture-secret-description');
            expect(result.stdout).not.toContain('private-lint-signature');
            expect(result.stdout).not.toContain('windows secret');
        }
        expect([hashTree(project), hashTree(awmHome)]).toEqual(before);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

testWithNoFollow('compiled coverage keeps static verdict stable while --min changes only recurrence emphasis', () => {
    const { tmp, project, awmHome } = runWithFixture();
    try {
        const before = [hashTree(project), hashTree(awmHome)];
        const run = (min: string) => spawnSync(process.execPath, [bin, 'sensors', 'coverage', '--json', '--min', min], {
            cwd: project, encoding: 'utf8', env: { ...process.env, AWM_HOME: awmHome, AWM_NO_UPDATE_CHECK: '1' },
        });
        const defaultReport = JSON.parse(run('2').stdout ?? '');
        const minThree = JSON.parse(run('3').stdout ?? '');
        expect(defaultReport.static).toEqual(minThree.static);
        expect(defaultReport.overall).toBe(minThree.overall);
        expect(defaultReport.empirical.classes[0]).toMatchObject({ occurrences: 2, recurrent: true });
        expect(minThree.empirical.classes[0]).toMatchObject({ occurrences: 2, recurrent: false });
        expect([hashTree(project), hashTree(awmHome)]).toEqual(before);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

testWithNoFollow('informative states exit zero; malformed contract exits non-zero (R2.7, R2.9)', () => {
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
    expect(JSON.parse(gaps.stdout ?? '')).toMatchObject({ overall: 'inconclusive' });
    expect(noReference.status).toBe(0);
    expect(JSON.parse(noReference.stdout ?? '')).toMatchObject({ static: { reason: 'no_reference' } });
    expect(malformed.status).toBe(1);
    expect(`${malformed.stdout ?? ''}${malformed.stderr ?? ''}`).toContain('schemaVersion must be 1');
});
