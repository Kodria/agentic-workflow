import fs from 'fs';
import path from 'path';
import { mkCanonicalTmpDir } from '../../../support/tmp';
import { observeDetector } from '../../../../src/commands/sensors/coverage/evidence';
import { MAX_COVERAGE_FILE_BYTES, type CoverageDetectorContract } from '../../../../src/commands/sensors/coverage/contract';

let root: string;

beforeEach(() => { root = mkCanonicalTmpDir('awm-coverage-evidence-'); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const detector: CoverageDetectorContract = {
    sensor: 'lint',
    evidence: {
        commandIncludes: ['eslint', '--config'],
        files: [{ path: 'eslint.config.js', containsAll: ['no-unreachable'] }],
    },
};

test('active matching sensor with all AND evidence is covered (R2.2)', () => {
    fs.writeFileSync(path.join(root, 'eslint.config.js'), "rules: { 'no-unreachable': 'error' }");

    expect(observeDetector(root, 'style', 0, detector, {
        cmd: 'npx eslint . --config eslint.config.js', enabled: true,
    })).toEqual({
        classId: 'style',
        detectorIndex: 0,
        sensor: 'lint',
        status: 'covered',
        evidence: [
            { kind: 'command', status: 'matched' },
            { kind: 'file', path: 'eslint.config.js', status: 'matched' },
            { kind: 'marker', path: 'eslint.config.js', ordinal: 1, status: 'matched' },
        ],
    });
});

test.each([
    [undefined, 'missing'],
    [{ cmd: 'npx eslint .', enabled: false }, 'disabled'],
    [{ cmd: 'custom-linter .' }, 'unverifiable'],
    [{ enabled: true }, 'unverifiable'],
] as const)('maps sensor availability/config %# to %s (R2.3, R2.5)', (sensor, expected) => {
    expect(observeDetector(root, 'style', 0, detector, sensor)).toMatchObject({ status: expected });
});

test('recognized command plus missing file is ineffective (R2.4)', () => {
    const out = observeDetector(root, 'style', 0, detector, { cmd: 'eslint --config eslint.config.js' });

    expect(out.status).toBe('ineffective');
    expect(out.evidence).toContainEqual({ kind: 'file', path: 'eslint.config.js', status: 'missing' });
});

test('recognized command plus missing literal marker is ineffective (R2.4)', () => {
    fs.writeFileSync(path.join(root, 'eslint.config.js'), 'export default []');
    const out = observeDetector(root, 'style', 0, detector, { cmd: 'eslint --config eslint.config.js' });

    expect(out.status).toBe('ineffective');
    expect(out.evidence).toContainEqual({ kind: 'marker', path: 'eslint.config.js', ordinal: 1, status: 'missing' });
});

test.each(['symlink', 'oversize'] as const)('%s evidence is unverifiable, never green or missing (R2.5a, R2.11)', (kind) => {
    const target = path.join(root, 'target.js');
    fs.writeFileSync(target, 'no-unreachable');
    const file = path.join(root, 'eslint.config.js');
    if (kind === 'symlink') fs.symlinkSync(target, file);
    if (kind === 'oversize') fs.writeFileSync(file, Buffer.alloc(MAX_COVERAGE_FILE_BYTES + 1));

    expect(observeDetector(root, 'style', 0, detector, { cmd: 'eslint --config eslint.config.js' })).toMatchObject({
        status: 'unverifiable',
        evidence: expect.arrayContaining([{ kind: 'file', path: 'eslint.config.js', status: 'unverifiable' }]),
    });
});

test('read errors are unverifiable independently of host permissions (R2.5a)', () => {
    fs.writeFileSync(path.join(root, 'eslint.config.js'), 'no-unreachable');
    const io = {
        lstatSync: fs.lstatSync,
        readFileUtf8: () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); },
    };

    expect(observeDetector(root, 'style', 0, detector,
        { cmd: 'eslint --config eslint.config.js' }, io).status).toBe('unverifiable');
});

test('rejects an evidence path that escapes the project root (R2.11)', () => {
    const escaped: CoverageDetectorContract = {
        sensor: 'lint',
        evidence: { files: [{ path: '../outside.txt', containsAll: [] }] },
    };

    expect(() => observeDetector(root, 'style', 0, escaped, { cmd: 'eslint' }))
        .toThrow('evidence path escaped project root: ../outside.txt');
});

test('reports only ordinal/path/status and never leaks command or marker text (RF-1.4)', () => {
    fs.writeFileSync(path.join(root, 'eslint.config.js'), 'secret-marker');
    const serialized = JSON.stringify(observeDetector(root, 'style', 0, detector,
        { cmd: 'private-command eslint --config' }));

    expect(serialized).not.toContain('private-command');
    expect(serialized).not.toContain('no-unreachable');
    expect(serialized).not.toContain('secret-marker');
});
