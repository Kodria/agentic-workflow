import fs from 'fs';
import path from 'path';
import { mkCanonicalTmpDir } from '../../../support/tmp';
import { resolveCoverageInputs } from '../../../../src/commands/sensors/coverage/resolve';

let root: string;
let awmHome: string;
let project: string;

beforeEach(() => {
    root = mkCanonicalTmpDir('awm-coverage-resolve-');
    awmHome = path.join(root, 'home');
    project = path.join(root, 'project');
    fs.mkdirSync(path.join(project, '.awm'), { recursive: true });
    process.env.AWM_HOME = awmHome;
});
afterEach(() => {
    delete process.env.AWM_HOME;
    fs.rmSync(root, { recursive: true, force: true });
});

const configure = (names: string[]) => {
    fs.mkdirSync(awmHome, { recursive: true });
    fs.writeFileSync(path.join(awmHome, 'registries.json'), JSON.stringify(names.map((name) => ({ name, remote: 'fixture' }))));
};
const writeManifest = (body: unknown) => fs.writeFileSync(path.join(project, '.awm', 'sensors.json'),
    typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
const coverage = { schemaVersion: 1, classes: {
    formatting: { description: 'Formatting', detectors: [{ sensor: 'format' }], remedy: { summary: 'Add formatter', command: 'npm i -D prettier' } },
} };
const writePack = (registry: string, pack: string, body: object | string | Buffer) => {
    const dir = path.join(awmHome, 'registries', registry, 'sensor-packs', pack);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack.json'), typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

test('no manifest returns not_configured without reading registries', () => {
    fs.rmSync(path.join(project, '.awm', 'sensors.json'), { force: true });
    fs.mkdirSync(awmHome, { recursive: true });
    fs.writeFileSync(path.join(awmHome, 'registries.json'), '{malformed');
    const originalLstat = fs.lstatSync;
    const lstat = jest.spyOn(fs, 'lstatSync').mockImplementation(((file: fs.PathLike, ...args: unknown[]) => {
        if (typeof file === 'string' && file.endsWith(path.join('.awm', 'sensors.json'))) {
            throw Object.assign(new Error('missing manifest'), { code: 'ENOENT' });
        }
        return originalLstat(file, ...(args as []));
    }) as typeof fs.lstatSync);
    try {
        expect(resolveCoverageInputs(project)).toEqual({ kind: 'not_configured' });
    } finally {
        lstat.mockRestore();
    }
});

test('selects the first configured registry containing the exact pack', () => {
    writeManifest({ pack: 'js-ts', sensors: {} });
    configure(['first', 'second']);
    writePack('first', 'generic', { name: 'generic', sensors: {} });
    writePack('second', 'js-ts', { name: 'js-ts', sensors: {}, coverage });
    expect(resolveCoverageInputs(project)).toMatchObject({ kind: 'ready', pack: 'js-ts', registry: 'second' });
});

test('registry ordering chooses the earlier exact pack when both registries contain it', () => {
    writeManifest({ pack: 'js-ts', sensors: {} });
    configure(['first', 'second']);
    writePack('first', 'js-ts', { name: 'js-ts', sensors: {}, coverage });
    writePack('second', 'js-ts', { name: 'js-ts', sensors: {}, coverage });
    expect(resolveCoverageInputs(project)).toMatchObject({ kind: 'ready', registry: 'first' });
});

test('old pack without coverage is no_reference, not covered', () => {
    writeManifest({ pack: 'js-ts', sensors: {} });
    configure(['baseline']);
    writePack('baseline', 'js-ts', { name: 'js-ts', sensors: {} });
    expect(resolveCoverageInputs(project)).toMatchObject({ kind: 'no_reference', pack: 'js-ts', registry: 'baseline' });
});

test('normal regular coverage inputs resolve regardless of no-follow availability', () => {
    writeManifest({ pack: 'js-ts', sensors: {} });
    configure(['baseline']);
    writePack('baseline', 'js-ts', { name: 'js-ts', sensors: {}, coverage });

    expect(resolveCoverageInputs(project)).toMatchObject({ kind: 'ready' });
});

test.each([
    ['manifest-malformed', '{broken', /Invalid JSON.*sensors\.json/],
    ['manifest-oversize', Buffer.alloc(1024 * 1024 + 1), /sensors\.json.*exceeds 1 MiB/],
] as const)('rejects %s', (_name, body, expected) => {
    writeManifest(body);
    expect(() => resolveCoverageInputs(project)).toThrow(expected);
});

test.each([
    ['pack-malformed', '{broken', /Invalid JSON.*pack\.json/],
    ['pack-oversize', Buffer.alloc(1024 * 1024 + 1), /pack source exceeds the 1 MiB limit/],
] as const)('rejects %s', (_name, body, expected) => {
    writeManifest({ pack: 'js-ts', sensors: {} });
    configure(['baseline']);
    writePack('baseline', 'js-ts', body);
    expect(() => resolveCoverageInputs(project)).toThrow(expected);
});

test('rejects a symlinked manifest without dereferencing it', () => {
    const manifest = path.join(project, '.awm', 'sensors.json');
    const target = path.join(root, 'manifest.json');
    fs.writeFileSync(target, JSON.stringify({ pack: 'js-ts', sensors: {} }));
    fs.symlinkSync(target, manifest);
    expect(() => resolveCoverageInputs(project)).toThrow(/sensors\.json.*regular file/);
});

test('rejects a dangling symlinked manifest without reporting not_configured', () => {
    const manifest = path.join(project, '.awm', 'sensors.json');
    fs.symlinkSync(path.join(root, 'missing-manifest.json'), manifest);
    expect(() => resolveCoverageInputs(project)).toThrow(/sensors\.json.*regular file/);
});

test('rejects a JSON object that is not a valid pack', () => {
    writeManifest({ pack: 'js-ts', sensors: {} });
    configure(['baseline']);
    writePack('baseline', 'js-ts', { coverage });
    expect(() => resolveCoverageInputs(project)).toThrow(/Invalid sensor pack.*name/);
});

test('rejects registry names that are not safe path components', () => {
    writeManifest({ pack: 'js-ts', sensors: {} });
    configure(['']);
    expect(() => resolveCoverageInputs(project)).toThrow(/malformed entry name|Invalid registry name/);
});

test.each([
    [{ schemaVersion: 3, name: 'js-ts', sensors: {}, coverage: {} }, /supported: legacy, 2/],
    [{ schemaVersion: 2, name: 'js-ts', sensors: {}, coverage: {} }, /sensors must be nonempty/],
])('fails closed before reading coverage from invalid versioned packs', (pack, expected) => {
    writeManifest({ pack: 'js-ts', sensors: {} });
    configure(['baseline']);
    writePack('baseline', 'js-ts', pack);
    expect(() => resolveCoverageInputs(project)).toThrow(expected);
});
