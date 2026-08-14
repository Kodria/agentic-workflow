import fs from 'fs';
import os from 'os';
import path from 'path';
import { mkCanonicalTmpDir } from '../../../support/tmp';
import { observeDetector } from '../../../../src/commands/sensors/coverage/evidence';
import { MAX_COVERAGE_FILE_BYTES, type CoverageDetectorContract } from '../../../../src/commands/sensors/coverage/contract';

let root: string;
let externalRoot: string | undefined;

beforeEach(() => {
    root = mkCanonicalTmpDir('awm-coverage-evidence-');
    externalRoot = undefined;
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (externalRoot) fs.rmSync(externalRoot, { recursive: true, force: true });
});

const detector: CoverageDetectorContract = {
    sensor: 'lint',
    evidence: {
        commandIncludes: ['eslint', '--config'],
        files: [{ path: 'eslint.config.js', containsAll: ['no-unreachable'] }],
    },
};

const noFollowUnavailableOnNativeWindows = process.platform === 'win32'
    && typeof fs.constants.O_NOFOLLOW !== 'number';

const regularFileStatus = (posixStatus: 'covered' | 'ineffective') =>
    noFollowUnavailableOnNativeWindows ? 'unverifiable' : posixStatus;

test('active matching sensor with all AND evidence is covered (R2.2)', () => {
    fs.writeFileSync(path.join(root, 'eslint.config.js'), "rules: { 'no-unreachable': 'error' }");

    const observed = observeDetector(root, 'style', 0, detector, {
        cmd: 'npx eslint . --config eslint.config.js', enabled: true,
    });

    if (noFollowUnavailableOnNativeWindows) {
        expect(observed).toMatchObject({
            status: 'unverifiable',
            evidence: expect.arrayContaining([{ kind: 'file', path: 'eslint.config.js', status: 'unverifiable' }]),
        });
        return;
    }
    expect(observed).toEqual({
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

test('structured v2 commands supply structural coverage evidence without exposing argv', () => {
    fs.writeFileSync(path.join(root, 'eslint.config.js'), "rules: { 'no-unreachable': 'error' }");

    const observed = observeDetector(root, 'style', 0, detector, {
        enabled: true,
        command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.', '--config', 'eslint.config.js'] },
    });

    expect(observed.status).toBe(regularFileStatus('covered'));
    expect(JSON.stringify(observed)).not.toContain('--config');
});

test.each([
    [undefined, 'missing'],
    [{ cmd: 'npx eslint .', enabled: false }, 'disabled'],
    [{ cmd: 'custom-linter .' }, 'unverifiable'],
    [{ enabled: true }, 'unverifiable'],
] as const)('maps sensor availability/config %# to %s (R2.3, R2.5)', (sensor, expected) => {
    expect(observeDetector(root, 'style', 0, detector, sensor)).toMatchObject({ status: expected });
});

test('records absent and custom required commands without exposing their text (R2.5)', () => {
    const absent = observeDetector(root, 'style', 0, detector, { enabled: true });
    const custom = observeDetector(root, 'style', 0, detector, { cmd: 'private-linter --private-flag' });

    expect(absent).toMatchObject({
        status: 'unverifiable',
        evidence: [{ kind: 'command', status: 'missing' }],
    });
    expect(custom).toMatchObject({
        status: 'unverifiable',
        evidence: [{ kind: 'command', status: 'custom' }],
    });
    expect(JSON.stringify({ absent, custom })).not.toContain('private-linter');
    expect(JSON.stringify({ absent, custom })).not.toContain('private-flag');
});

test('recognized command plus missing file is ineffective (R2.4)', () => {
    const out = observeDetector(root, 'style', 0, detector, { cmd: 'eslint --config eslint.config.js' });

    expect(out.status).toBe('ineffective');
    expect(out.evidence).toContainEqual({ kind: 'file', path: 'eslint.config.js', status: 'missing' });
});

test('recognized command plus missing literal marker is ineffective (R2.4)', () => {
    fs.writeFileSync(path.join(root, 'eslint.config.js'), 'export default []');
    const out = observeDetector(root, 'style', 0, detector, { cmd: 'eslint --config eslint.config.js' });

    expect(out.status).toBe(regularFileStatus('ineffective'));
    if (noFollowUnavailableOnNativeWindows) {
        expect(out.evidence).toContainEqual({ kind: 'file', path: 'eslint.config.js', status: 'unverifiable' });
    } else {
        expect(out.evidence).toContainEqual({ kind: 'marker', path: 'eslint.config.js', ordinal: 1, status: 'missing' });
    }
});

test('native Windows without no-follow support never certifies regular evidence from its contents', () => {
    fs.writeFileSync(path.join(root, 'eslint.config.js'), 'no-unreachable');

    const observed = observeDetector(root, 'style', 0, detector, { cmd: 'eslint --config eslint.config.js' });

    if (noFollowUnavailableOnNativeWindows) {
        expect(observed.status).toBe('unverifiable');
        expect(observed.status).not.toBe('covered');
        expect(observed.status).not.toBe('ineffective');
    } else {
        expect(observed.status).toBe('covered');
    }
});

test('unverifiable file evidence dominates missing evidence in the detector result (R2.5a)', () => {
    const mixed: CoverageDetectorContract = {
        sensor: 'lint',
        evidence: {
            files: [
                { path: 'missing.js', containsAll: [] },
                { path: 'linked.js', containsAll: ['no-unreachable'] },
            ],
        },
    };
    const target = path.join(root, 'target.js');
    fs.writeFileSync(target, 'no-unreachable');
    fs.symlinkSync(target, path.join(root, 'linked.js'));

    const out = observeDetector(root, 'style', 0, mixed, { cmd: 'eslint' });

    expect(out.status).toBe('unverifiable');
    expect(out.evidence).toEqual(expect.arrayContaining([
        { kind: 'file', path: 'missing.js', status: 'missing' },
        { kind: 'file', path: 'linked.js', status: 'unverifiable' },
    ]));
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

test('does not trust injected lstat semantics to make symlink evidence regular (R2.11)', () => {
    const target = path.join(root, 'target.js');
    const file = path.join(root, 'eslint.config.js');
    fs.writeFileSync(target, 'no-unreachable');
    fs.symlinkSync(target, file);
    const command = { cmd: 'eslint --config eslint.config.js' };

    const observedWithLstat = observeDetector(root, 'style', 0, detector, command, {
        lstatSync: fs.lstatSync,
    });
    const simulatedStatRegression = observeDetector(root, 'style', 0, detector, command, {
        lstatSync: fs.statSync,
    });

    expect(observedWithLstat.status).toBe('unverifiable');
    expect(simulatedStatRegression.status).toBe('unverifiable');
});

test('rejects a file swapped to a symlink after lstat without reading its target (R2.11)', () => {
    const file = path.join(root, 'eslint.config.js');
    externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-coverage-external-'));
    const outsideTarget = path.join(externalRoot, 'outside-target.js');
    fs.writeFileSync(file, 'no-unreachable');
    fs.writeFileSync(outsideTarget, 'no-unreachable private-target-content');
    const reads: Array<string | number> = [];

    const out = observeDetector(root, 'style', 0, detector, { cmd: 'eslint --config eslint.config.js' }, {
        lstatSync: (input) => {
            const stat = fs.lstatSync(input);
            fs.rmSync(input);
            fs.symlinkSync(outsideTarget, input);
            return stat;
        },
        readSync: (fd, buffer, offset, length, position) => {
            reads.push(fd);
            return fs.readSync(fd, buffer, offset, length, position);
        },
    });

    expect(out).toMatchObject({
        status: 'unverifiable',
        evidence: expect.arrayContaining([{ kind: 'file', path: 'eslint.config.js', status: 'unverifiable' }]),
    });
    expect(reads).toEqual([]);
});

test('rejects a non-regular descriptor before reading it (R2.11)', () => {
    const file = path.join(root, 'eslint.config.js');
    fs.writeFileSync(file, 'no-unreachable');
    const reads: number[] = [];

    const out = observeDetector(root, 'style', 0, detector, { cmd: 'eslint --config eslint.config.js' }, {
        lstatSync: fs.lstatSync,
        openSync: fs.openSync,
        fstatSync: () => fs.statSync(root),
        readSync: (fd, buffer, offset, length, position) => {
            reads.push(fd as number);
            return fs.readSync(fd, buffer, offset, length, position);
        },
        closeSync: fs.closeSync,
    });

    expect(out).toMatchObject({
        status: 'unverifiable',
        evidence: expect.arrayContaining([{ kind: 'file', path: 'eslint.config.js', status: 'unverifiable' }]),
    });
    expect(reads).toEqual([]);
});

test('rejects evidence that grows beyond the byte cap after descriptor validation (R2.11)', () => {
    const file = path.join(root, 'eslint.config.js');
    fs.writeFileSync(file, 'no-unreachable');

    const out = observeDetector(root, 'style', 0, detector, { cmd: 'eslint --config eslint.config.js' }, {
        lstatSync: fs.lstatSync,
        openSync: fs.openSync,
        fstatSync: (fd) => {
            const stat = fs.fstatSync(fd);
            fs.appendFileSync(file, Buffer.alloc(MAX_COVERAGE_FILE_BYTES + 1));
            return stat;
        },
        closeSync: fs.closeSync,
    });

    expect(out).toMatchObject({
        status: 'unverifiable',
        evidence: expect.arrayContaining([{ kind: 'file', path: 'eslint.config.js', status: 'unverifiable' }]),
    });
});

test('read errors are unverifiable independently of host permissions (R2.5a)', () => {
    fs.writeFileSync(path.join(root, 'eslint.config.js'), 'no-unreachable');
    const io = {
        lstatSync: fs.lstatSync,
        readSync: () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); },
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

test.each([
    [{}, 'style', 0, 'root must be a non-empty string'],
    ['   ', 'style', 0, 'root must be a non-empty string'],
    ['/valid-root', '', 0, 'classId must be a non-empty string'],
    ['/valid-root', '   ', 0, 'classId must be a non-empty string'],
    ['/valid-root', 'style', -1, 'detectorIndex must be a non-negative integer'],
    ['/valid-root', 'style', 0.5, 'detectorIndex must be a non-negative integer'],
] as const)('rejects malformed public arguments %#', (inputRoot, classId, detectorIndex, message) => {
    expect(() => observeDetector(inputRoot, classId, detectorIndex, detector, { cmd: 'eslint --config eslint.config.js' }))
        .toThrow(`observeDetector: ${message}`);
});

test('reports only ordinal/path/status and never leaks command or marker text (RF-1.4)', () => {
    fs.writeFileSync(path.join(root, 'eslint.config.js'), 'secret-marker');
    const serialized = JSON.stringify(observeDetector(root, 'style', 0, detector,
        { cmd: 'private-command eslint --config' }));

    expect(serialized).not.toContain('private-command');
    expect(serialized).not.toContain('no-unreachable');
    expect(serialized).not.toContain('secret-marker');
});
