import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { Worker } from 'worker_threads';

import {
    createSecureFsBoundary,
    loadNativeSecureFsBridge,
    nativeArtifactStatus,
    resolvePackageRoot,
    type NativeSecureFsBinding,
} from '../../../src/core/secure-fs/native-bridge';

type NativeProjectLeaseBinding = NativeSecureFsBinding & Readonly<{
    acquireProjectLease(projectRoot: string): object;
    releaseProjectLease(token: object): void;
}>;

type ProjectLeaseBoundary = Readonly<{
    withProjectLease<T>(projectRoot: string, operation: () => T): T;
}>;

const artifact = (root: string, platform: NodeJS.Platform, arch: string): string =>
    path.join(root, 'prebuilds', `${platform}-${arch}`, 'secure_fs.node');

const releaseTargets = [
    ['linux', 'x64'], ['linux', 'arm64'],
    ['darwin', 'x64'], ['darwin', 'arm64'],
    ['win32', 'x64'], ['win32', 'arm64'],
] as const;

function identityFixture(seed = 1): Buffer {
    const identity = Buffer.alloc(24);
    identity.write('SFSI', 0, 'ascii');
    identity[4] = 1;
    identity[5] = process.platform === 'win32' ? 2 : 1;
    identity.writeBigUInt64LE(BigInt(seed), 8);
    identity.writeBigUInt64LE(BigInt(seed + 1), 16);
    return identity;
}

describe('native secure-fs Windows source contract', () => {
    const windowsContractSource = (source: string): string => {
        const normalized = source.replace(/\r\n/g, '\n');
        return normalized.slice(
            normalized.indexOf('#else\nstruct WindowsParent'),
            normalized.indexOf('#endif\n\nbool WriteOptionsArg'),
        );
    };

    const windowsSource = (): string => windowsContractSource(
        fs.readFileSync(path.resolve(__dirname, '../../../native/secure_fs.cc'), 'utf8'),
    );

    it('finds the Windows contract in a CRLF checkout', () => {
        const source = fs.readFileSync(path.resolve(__dirname, '../../../native/secure_fs.cc'), 'utf8')
            .replace(/\r\n/g, '\n')
            .replace(/\n/g, '\r\n');

        expect(windowsContractSource(source)).toContain('NtCreateFile');
    });

    it('uses a verified root handle for every descendant open, create, and cleanup', () => {
        const source = windowsSource();

        expect(source).toMatch(/GetProcAddress\([^\n]+"NtCreateFile"/);
        expect(source).toMatch(/RootDirectory\s*=\s*root/);
        expect(source).not.toMatch(/\bCreateDirectoryW\b|\bDeleteFileW\b|parent\.directory/);
        expect(source.match(/\bCreateFileW\s*\(/g)).toHaveLength(1);
    });

    it('requests SYNCHRONIZE when opening a handle-relative directory', () => {
        expect(windowsSource()).toMatch(/OpenRelativeDirectoryNoReparse\([\s\S]*?FILE_TRAVERSE\s*\|\s*FILE_READ_ATTRIBUTES\s*\|\s*SYNCHRONIZE/);
    });

    it('does not combine directory opens with the incompatible reparse-point option', () => {
        const source = windowsSource();
        const start = source.indexOf('bool OpenRelativeDirectoryNoReparse');
        const end = source.indexOf('\nbool OpenWindowsParent', start);
        const opener = source.slice(start, end);

        expect(start).toBeGreaterThan(-1);
        expect(opener).toContain('kFileDirectoryFile | kFileSynchronousIoNonalert | kFileOpenForBackupIntent');
        expect(opener).not.toMatch(/kFileDirectoryFile\s*\|[^;]*kFileOpenReparsePoint/);
        expect(opener).toContain('VerifyDirectDirectoryIdentity');
    });

    it('preserves the terminal Win32 staging error for transaction diagnostics', () => {
        const source = windowsSource();
        const start = source.indexOf('bool CreatePrivateStagingFile');
        const end = source.indexOf('\nbool DiscardStagingFile', start);
        const staging = source.slice(start, end);

        expect(start).toBeGreaterThan(-1);
        expect(staging).toContain('DWORD* last_error');
        expect(staging).toContain('const DWORD error = GetLastError()');
        expect(staging).toContain('*last_error = error');
        expect(fs.readFileSync(path.resolve(__dirname, '../../../native/secure_fs.cc'), 'utf8'))
            .toMatch(/DWORD staging_error = ERROR_SUCCESS;[\s\S]*?CreatePrivateStagingFile\(parent, &staged, &staging_error\)/);
    });

    it('declares eval mode for the inline junction-race worker', () => {
        expect(fs.readFileSync(__filename, 'utf8'))
            .toMatch(/new Worker\([\s\S]*?`\s*, \{ eval: true, workerData:/);
    });

    it('keeps an exclusive verified target handle through an atomic POSIX-semantics replacement', () => {
        const source = windowsSource();
        const fenceStart = source.indexOf('HANDLE OpenRegularFileForReplacementFence');
        const fenceEnd = source.indexOf('\n}', fenceStart);
        const replacementFence = source.slice(fenceStart, fenceEnd);

        expect(fenceStart).toBeGreaterThan(-1);
        expect(replacementFence).toContain('OpenRegularFileNoReparse(parent, 0)');
        expect(source).toMatch(/kFileRenameReplaceIfExists\s*=\s*0x00000001/);
        expect(source).toMatch(/kFileRenamePosixSemantics\s*=\s*0x00000002/);
        expect(source).toMatch(/rename->Flags\s*=\s*kFileRenameReplaceIfExists\s*\|\s*kFileRenamePosixSemantics/);
        expect(replacementFence).not.toMatch(/\bLockFileEx\b|\bUnlockFileEx\b/);
        expect(source).toMatch(/LockFileEx\([^;]+LOCKFILE_EXCLUSIVE_LOCK\s*\|\s*LOCKFILE_FAIL_IMMEDIATELY/);
        expect(source).toMatch(/\bUnlockFileEx\b/);
    });

    it('removes a verified observed target through its exclusive handle', () => {
        const source = fs.readFileSync(path.resolve(__dirname, '../../../native/secure_fs.cc'), 'utf8');
        const removalStart = source.indexOf('napi_value RemoveObservedProjectFile');
        const removal = source.slice(removalStart, source.indexOf('napi_value WriteProjectTransaction', removalStart));

        expect(removalStart).toBeGreaterThan(-1);
        expect(removal).toContain('OpenRegularFileNoReparse(parent, 0)');
        expect(removal).toContain('SetFileInformationByHandle(target, FileDispositionInfo');
        expect(removal).not.toMatch(/\bDeleteFileW\b/);
    });
});

describe('native secure-fs POSIX source contract', () => {
    const source = (): string => fs.readFileSync(path.resolve(__dirname, '../../../native/secure_fs.cc'), 'utf8');

    it('uses an unpredictable nonce and a bounded retry loop for descriptor-relative staging', () => {
        const nativeSource = source();

        expect(nativeSource).toMatch(/constexpr unsigned int kMaxStagingAttempts = 128/);
        expect(nativeSource).toMatch(/bool FillRandomBytes\(/);
        expect(nativeSource).toMatch(/\bgetrandom\b/);
        expect(nativeSource).toMatch(/\barc4random_buf\b/);
        expect(nativeSource).toMatch(/attempt < kMaxStagingAttempts/);
        expect(nativeSource).toMatch(/openat\(parent, temporary->c_str\(\),[^;]*O_EXCL[^;]*O_NOFOLLOW/);
        expect(nativeSource).toMatch(/if \(errno != EEXIST\) return -1/);
    });
});

describe('native secure-fs bridge loader', () => {
    let root: string;

    beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-secure-fs-')); });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('locates prebuilds at package root from source and compiled layouts', () => {
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        expect(resolvePackageRoot(path.join(root, 'src', 'core', 'secure-fs'))).toBe(root);
        expect(resolvePackageRoot(path.join(root, 'dist', 'src', 'core', 'secure-fs'))).toBe(root);
    });

    it('selects the artifact for the exact supported platform and architecture', () => {
        const selected = artifact(root, 'linux', 'x64');
        fs.mkdirSync(path.dirname(selected), { recursive: true });
        fs.writeFileSync(selected, 'test artifact');
        const binding: NativeProjectLeaseBinding = {
            acquireProjectLease: jest.fn(() => ({})), releaseProjectLease: jest.fn(),
            readRegularFile: jest.fn(), writeProjectTransaction: jest.fn(), removeObservedProjectFile: jest.fn(),
        };

        expect(loadNativeSecureFsBridge({ root, platform: 'linux', arch: 'x64', load: candidate => {
            expect(candidate).toBe(selected);
            return binding;
        } })).toBe(binding);
        expect(nativeArtifactStatus({ root, platform: 'linux', arch: 'x64' })).toEqual({
            status: 'available', platform: 'linux', arch: 'x64', path: selected,
        });
    });

    it('fails before mutation when its selected artifact is absent', () => {
        const mutate = jest.fn();

        expect(() => loadNativeSecureFsBridge({ root, platform: 'win32', arch: 'arm64', load: mutate }))
            .toThrow('secure-fs native artifact is unavailable for win32-arm64');
        expect(mutate).not.toHaveBeenCalled();
        expect(nativeArtifactStatus({ root, platform: 'win32', arch: 'arm64' })).toEqual({
            status: 'missing', platform: 'win32', arch: 'arm64', path: artifact(root, 'win32', 'arm64'),
        });
    });

    it('rejects a legacy artifact that lacks the project lease primitives', () => {
        const selected = artifact(root, 'linux', 'x64');
        fs.mkdirSync(path.dirname(selected), { recursive: true });
        fs.writeFileSync(selected, 'test artifact');

        expect(() => loadNativeSecureFsBridge({
            root,
            platform: 'linux',
            arch: 'x64',
            load: () => ({ readRegularFile: jest.fn(), writeProjectTransaction: jest.fn() }) as unknown as NativeSecureFsBinding,
        })).toThrow('secure-fs native artifact is incompatible for linux-x64');
    });

    it('requires every declared release artifact before package verification succeeds', () => {
        const prebuilds = path.join(root, 'prebuilds');
        const script = path.resolve(__dirname, '../../../scripts/assert-native-package.js');
        for (const [platform, arch] of releaseTargets.slice(0, -1)) {
            const selected = artifact(root, platform, arch);
            fs.mkdirSync(path.dirname(selected), { recursive: true });
            fs.writeFileSync(selected, 'test artifact');
        }

        expect(() => execFileSync(process.execPath, [script], {
            cwd: path.resolve(__dirname, '../../..'),
            env: { ...process.env, AWM_NATIVE_PREBUILDS: prebuilds },
            stdio: 'pipe',
        })).toThrow(/win32-arm64/);
    });

    it('rejects an unsupported platform before loading any artifact', () => {
        const load = jest.fn();
        expect(() => loadNativeSecureFsBridge({ root, platform: 'freebsd' as NodeJS.Platform, arch: 'x64', load }))
            .toThrow('secure-fs native bridge does not support freebsd-x64');
        expect(load).not.toHaveBeenCalled();
    });
});

describe('secure-fs TypeScript boundary', () => {
    const projectRoot = path.resolve(path.parse(process.cwd()).root, 'project');
    const rawIdentity = identityFixture();
    const binding: NativeProjectLeaseBinding = {
        acquireProjectLease: jest.fn(() => ({})),
        releaseProjectLease: jest.fn(),
        readRegularFile: jest.fn(() => ({ bytes: Buffer.from('verified bytes'), identity: rawIdentity })),
        writeProjectTransaction: jest.fn(),
        removeObservedProjectFile: jest.fn(),
    };

    beforeEach(() => { jest.clearAllMocks(); });

    it('holds one opaque native lease around the callback and releases it after success or exception', () => {
        const rawLease = Object.freeze({ native: true });
        const events: string[] = [];
        const leaseBinding = {
            ...binding,
            acquireProjectLease: jest.fn(() => { events.push('acquire'); return rawLease; }),
            releaseProjectLease: jest.fn((token: object) => {
                expect(token).toBe(rawLease);
                events.push('release');
            }),
        };
        const bridge = createSecureFsBoundary(() => leaseBinding) as ProjectLeaseBoundary;
        const operation = jest.fn(() => { events.push('callback'); return 42; });

        expect(bridge.withProjectLease(projectRoot, operation)).toBe(42);
        expect(operation).toHaveBeenCalledWith();
        expect(events).toEqual(['acquire', 'callback', 'release']);
        expect('releaseProjectLease' in bridge).toBe(false);

        const callbackFailure = new Error('callback failed');
        expect(() => bridge.withProjectLease(projectRoot, () => {
            events.push('throwing callback');
            throw callbackFailure;
        })).toThrow(callbackFailure);
        expect(events.slice(-3)).toEqual(['acquire', 'throwing callback', 'release']);
        expect(leaseBinding.releaseProjectLease).toHaveBeenCalledTimes(2);
    });

    it('passes only an absolute project root, a safe relative destination, and opaque bytes to the native transaction', () => {
        const bridge = createSecureFsBoundary(() => binding);
        const payload = Buffer.from('{"schemaVersion":3}\n');

        bridge.writeProjectTransaction(projectRoot, '.awm/sensors.json', payload, { mode: 'create', createParents: true });

        expect(binding.writeProjectTransaction).toHaveBeenCalledWith(projectRoot, path.join('.awm', 'sensors.json'), payload, { mode: 'create', createParents: true });
        expect(() => bridge.writeProjectTransaction('relative', '.awm/sensors.json', payload, { mode: 'create', createParents: true })).toThrow('absolute');
        expect(() => bridge.writeProjectTransaction(projectRoot, '../sensors.json', payload, { mode: 'create', createParents: true })).toThrow('project-relative');
        expect(() => bridge.writeProjectTransaction(projectRoot, '.awm/sensors.json', 'not bytes' as never, { mode: 'create', createParents: true })).toThrow('Buffer');
    });

    it('permits compensation only for an opaque identity from the exact observed destination', () => {
        const bridge = createSecureFsBoundary(() => binding);
        const observed = bridge.readRegularFile(path.join(projectRoot, '.awm', 'created.json'), 1024);

        bridge.removeObservedProjectFile(projectRoot, '.awm/created.json', observed.identity);

        expect(binding.removeObservedProjectFile).toHaveBeenCalledWith(
            projectRoot, path.join('.awm', 'created.json'), rawIdentity,
        );
        expect(() => bridge.removeObservedProjectFile(projectRoot, '.awm/other.json', observed.identity))
            .toThrow(/exact observed destination/i);
        expect(() => bridge.removeObservedProjectFile(projectRoot, '.awm/created.json', rawIdentity as never))
            .toThrow(/opaque identity/i);
    });

    it('rejects NUL bytes in absolute paths before invoking the native binding', () => {
        const bridge = createSecureFsBoundary(() => binding);
        const operation = jest.fn();

        expect(() => bridge.withProjectLease(`${projectRoot}\0ignored`, operation)).toThrow(/NUL byte/i);
        expect(() => bridge.readRegularFile(`${projectRoot}\0ignored`, 1024)).toThrow(/NUL byte/i);
        expect(() => bridge.writeProjectTransaction(`${projectRoot}\0ignored`, '.awm/sensors.json', Buffer.from('manifest'), {
            mode: 'create', createParents: true,
        })).toThrow(/NUL byte/i);
        expect(operation).not.toHaveBeenCalled();
        expect(binding.acquireProjectLease).not.toHaveBeenCalled();
        expect(binding.readRegularFile).not.toHaveBeenCalled();
        expect(binding.writeProjectTransaction).not.toHaveBeenCalled();
    });

    it('maps only the structured native no-replace conflict to a stable destination error', () => {
        const nativeConflict = Object.assign(new Error('native implementation detail'), {
            code: 'AWM_SECURE_FS_DESTINATION_EXISTS',
        });
        const conflictBinding = { ...binding, writeProjectTransaction: jest.fn(() => { throw nativeConflict; }) };
        const bridge = createSecureFsBoundary(() => conflictBinding);

        expect(() => bridge.writeProjectTransaction(projectRoot, '.awm/sensors.json', Buffer.from('manifest'), {
            mode: 'create', createParents: true,
        })).toThrow('project destination already exists');

        const ioFailure = new Error('secure-fs target exists or transaction failed');
        const failedBinding = { ...binding, writeProjectTransaction: jest.fn(() => { throw ioFailure; }) };
        const failedBridge = createSecureFsBoundary(() => failedBinding);
        expect(() => failedBridge.writeProjectTransaction(projectRoot, '.awm/sensors.json', Buffer.from('manifest'), {
            mode: 'create', createParents: true,
        })).toThrow(ioFailure);
    });

    it('accepts canonical forward-slash destinations independently of the host separator', () => {
        const bridge = createSecureFsBoundary(() => binding);
        const separator = Object.getOwnPropertyDescriptor(path, 'sep');
        Object.defineProperty(path, 'sep', { ...separator, value: '\\' });
        try {
            bridge.writeProjectTransaction(projectRoot, '.awm/assets/eslint.config.awm.mjs', Buffer.from('asset'), {
                mode: 'create', createParents: true,
            });
            expect(binding.writeProjectTransaction).toHaveBeenLastCalledWith(
                projectRoot, '.awm\\assets\\eslint.config.awm.mjs', Buffer.from('asset'), { mode: 'create', createParents: true },
            );
        } finally {
            Object.defineProperty(path, 'sep', separator!);
        }
    });

    it('rejects backslash-ambiguous destinations independently of the host separator', () => {
        const bridge = createSecureFsBoundary(() => binding);
        const separator = Object.getOwnPropertyDescriptor(path, 'sep');
        Object.defineProperty(path, 'sep', { ...separator, value: '\\' });
        try {
            expect(() => bridge.writeProjectTransaction(projectRoot, '.awm\\sensors.json', Buffer.from('manifest'), {
                mode: 'create', createParents: true,
            })).toThrow('project-relative');
        } finally {
            Object.defineProperty(path, 'sep', separator!);
        }
    });

    it('requires the exact native read bytes and opaque identity to fence a replacement transaction', () => {
        const bridge = createSecureFsBoundary(() => binding);
        const replacement = Buffer.from('{"schemaVersion":3}\n');
        const observed = bridge.readRegularFile(path.join(projectRoot, '.awm', 'sensors.json'), 1024);

        bridge.writeProjectTransaction(projectRoot, '.awm/sensors.json', replacement, {
            mode: 'replace', expected: observed.bytes, expectedIdentity: observed.identity, createParents: false,
        });

        expect(binding.writeProjectTransaction).toHaveBeenLastCalledWith(projectRoot, path.join('.awm', 'sensors.json'), replacement, {
            mode: 'replace', expected: Buffer.from('verified bytes'), expectedIdentity: rawIdentity, createParents: false,
        });
        expect(() => bridge.writeProjectTransaction(projectRoot, '.awm/sensors.json', replacement, { mode: 'replace', createParents: false } as never)).toThrow('expected');
        expect(() => bridge.writeProjectTransaction(projectRoot, '.awm/sensors.json', replacement, {
            mode: 'replace', expected: observed.bytes, createParents: false,
        } as never)).toThrow('identity');
        expect(() => bridge.writeProjectTransaction(projectRoot, '.awm/sensors.json', replacement, {
            mode: 'replace', expected: observed.bytes, expectedIdentity: rawIdentity, createParents: false,
        } as never)).toThrow('identity');
    });

    it('uses the native binding for a bounded regular-file read and returns an opaque identity token', () => {
        const bridge = createSecureFsBoundary(() => binding);
        const manifest = path.join(projectRoot, '.awm', 'sensors.json');
        const observed = bridge.readRegularFile(manifest, 1024);
        expect(observed.bytes).toEqual(Buffer.from('verified bytes'));
        expect(observed.identity).toEqual(expect.any(Object));
        expect(Buffer.isBuffer(observed.identity)).toBe(false);
        expect(Object.isFrozen(observed.identity)).toBe(true);
        expect(binding.readRegularFile).toHaveBeenCalledWith(manifest, 1024);
        expect(() => bridge.readRegularFile(manifest, 0)).toThrow('positive safe integer');
    });

    it.each([
        Buffer.from('legacy bytes-only result'),
        { bytes: Buffer.from('verified bytes') },
        { bytes: Buffer.from('verified bytes'), identity: Buffer.alloc(24) },
        { bytes: 'not bytes', identity: rawIdentity },
    ])('fails closed when the native read API returns an invalid result: %#', invalid => {
        const bridge = createSecureFsBoundary(() => ({
            acquireProjectLease: jest.fn(() => ({})),
            releaseProjectLease: jest.fn(),
            readRegularFile: jest.fn(() => invalid as never),
            writeProjectTransaction: jest.fn(),
            removeObservedProjectFile: jest.fn(),
        }));
        expect(() => bridge.readRegularFile(path.join(projectRoot, 'sensors.json'), 1024)).toThrow(/invalid.*read|identity/i);
    });
});

const nativeFixtureAvailable = ['linux', 'darwin', 'win32'].includes(process.platform)
    && ['x64', 'arm64'].includes(process.arch)
    && fs.existsSync(path.join(__dirname, '../../../prebuilds', `${process.platform}-${process.arch}`, 'secure_fs.node'));
const nativeOnly = nativeFixtureAvailable ? describe : describe.skip;

nativeOnly('native secure-fs identity fence fixtures', () => {
    let root: string;
    let binding: NativeSecureFsBinding;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-secure-fs-identity-'));
        binding = require(path.join(__dirname, '../../../prebuilds', `${process.platform}-${process.arch}`, 'secure_fs.node')) as NativeSecureFsBinding;
    });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('returns bytes with a canonical native identity from the same regular-file read', () => {
        const target = path.join(root, 'sensors.json');
        fs.writeFileSync(target, 'observed bytes');

        const observed = binding.readRegularFile(target, 1024);

        expect(observed.bytes).toEqual(Buffer.from('observed bytes'));
        expect(observed.identity).toHaveLength(24);
        expect(observed.identity.subarray(0, 4).toString('ascii')).toBe('SFSI');
        expect(observed.identity[4]).toBe(1);
        expect(observed.identity[5]).toBe(process.platform === 'win32' ? 2 : 1);
        expect(observed.identity.subarray(6, 8)).toEqual(Buffer.alloc(2));
    });

    it('rejects embedded NUL path arguments before any truncated filesystem access', () => {
        const target = path.join(root, 'sensors.json');
        fs.writeFileSync(target, 'owner bytes');

        expect(() => binding.acquireProjectLease(`${root}\0ignored`)).toThrow(/NUL byte/i);
        expect(() => binding.readRegularFile(`${target}\0ignored`, 1024)).toThrow(/NUL byte/i);
        expect(() => binding.writeProjectTransaction(`${root}\0ignored`, 'created.json', Buffer.from('new bytes'), {
            mode: 'create', createParents: false,
        })).toThrow(/NUL byte/i);
        expect(() => binding.writeProjectTransaction(root, 'sensors.json\0ignored', Buffer.from('new bytes'), {
            mode: 'create', createParents: false,
        })).toThrow(/NUL byte/i);
        expect(fs.readFileSync(target, 'utf8')).toBe('owner bytes');
        expect(fs.existsSync(path.join(root, 'created.json'))).toBe(false);
    });

    it('marks an existing create target as a structured no-replace conflict', () => {
        const target = path.join(root, 'sensors.json');
        fs.writeFileSync(target, 'owner bytes');

        let failure: NodeJS.ErrnoException | undefined;
        try {
            binding.writeProjectTransaction(root, 'sensors.json', Buffer.from('new bytes'), {
                mode: 'create', createParents: false,
            });
        } catch (error) {
            failure = error as NodeJS.ErrnoException;
        }

        expect(failure).toBeDefined();
        expect(failure).toMatchObject({ code: 'AWM_SECURE_FS_DESTINATION_EXISTS' });
        expect(fs.readFileSync(target, 'utf8')).toBe('owner bytes');
    });

    it('rejects a valid identity observed from a different same-byte file', () => {
        const target = path.join(root, 'sensors.json');
        const other = path.join(root, 'other.json');
        fs.writeFileSync(target, 'same bytes');
        fs.writeFileSync(other, 'same bytes');
        const targetRead = binding.readRegularFile(target, 1024);
        const wrongIdentity = binding.readRegularFile(other, 1024).identity;

        expect(() => binding.writeProjectTransaction(root, 'sensors.json', Buffer.from('new bytes'), {
            mode: 'replace', expected: targetRead.bytes, expectedIdentity: wrongIdentity, createParents: false,
        })).toThrow(/original changed|transaction failed/i);
        expect(fs.readFileSync(target, 'utf8')).toBe('same bytes');
    });

    it('rejects a replacement call with a missing identity token', () => {
        const target = path.join(root, 'sensors.json');
        fs.writeFileSync(target, 'observed bytes');
        const observed = binding.readRegularFile(target, 1024);

        expect(() => binding.writeProjectTransaction(root, 'sensors.json', Buffer.from('new bytes'), {
            mode: 'replace', expected: observed.bytes, createParents: false,
        } as never)).toThrow(/invalid.*arguments|identity/i);
        expect(fs.readFileSync(target, 'utf8')).toBe('observed bytes');
    });

    it.each([
        ['truncated', (identity: Buffer) => identity.subarray(0, identity.length - 1)],
        ['bad magic', (identity: Buffer) => { const invalid = Buffer.from(identity); invalid[0] ^= 0xff; return invalid; }],
        ['unsupported version', (identity: Buffer) => { const invalid = Buffer.from(identity); invalid[4] = 2; return invalid; }],
        ['wrong platform', (identity: Buffer) => { const invalid = Buffer.from(identity); invalid[5] = process.platform === 'win32' ? 1 : 2; return invalid; }],
        ['nonzero reserved bytes', (identity: Buffer) => { const invalid = Buffer.from(identity); invalid[6] = 1; return invalid; }],
    ])('rejects an identity token with %s before replacement', (_label, mutateIdentity) => {
        const target = path.join(root, 'sensors.json');
        fs.writeFileSync(target, 'observed bytes');
        const observed = binding.readRegularFile(target, 1024);

        expect(() => binding.writeProjectTransaction(root, 'sensors.json', Buffer.from('new bytes'), {
            mode: 'replace', expected: observed.bytes, expectedIdentity: mutateIdentity(observed.identity), createParents: false,
        })).toThrow(/invalid.*arguments|identity/i);
        expect(fs.readFileSync(target, 'utf8')).toBe('observed bytes');
    });

    it('does not replace a same-byte target substituted after the exact native read', () => {
        const target = path.join(root, 'sensors.json');
        const original = path.join(root, 'original-sensors.json');
        fs.writeFileSync(target, 'observed bytes');
        const observed = binding.readRegularFile(target, 1024);
        fs.renameSync(target, original);
        fs.writeFileSync(target, 'observed bytes');

        expect(() => binding.writeProjectTransaction(root, 'sensors.json', Buffer.from('new bytes'), {
            mode: 'replace', expected: observed.bytes, expectedIdentity: observed.identity, createParents: false,
        })).toThrow(/original changed|transaction failed/i);
        expect(fs.readFileSync(target, 'utf8')).toBe('observed bytes');
        expect(fs.readFileSync(original, 'utf8')).toBe('observed bytes');
    });

    it('removes the exact observed file but rejects a substituted same-byte destination', () => {
        const target = path.join(root, 'created.json');
        const original = path.join(root, 'original-created.json');
        fs.writeFileSync(target, 'created bytes');
        const observed = binding.readRegularFile(target, 1024);

        binding.removeObservedProjectFile(root, 'created.json', observed.identity);
        expect(fs.existsSync(target)).toBe(false);

        fs.writeFileSync(target, 'created bytes');
        const substituted = binding.readRegularFile(target, 1024);
        fs.renameSync(target, original);
        fs.writeFileSync(target, 'created bytes');
        expect(() => binding.removeObservedProjectFile(root, 'created.json', substituted.identity))
            .toThrow(/original changed|transaction failed|identity/i);
        expect(fs.readFileSync(target, 'utf8')).toBe('created bytes');
        expect(fs.readFileSync(original, 'utf8')).toBe('created bytes');
    });
});

const posixOnly = process.platform !== 'win32' && nativeFixtureAvailable ? describe : describe.skip;

posixOnly('native secure-fs POSIX staging fixtures', () => {
    let root: string;
    let binding: NativeSecureFsBinding;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-secure-fs-staging-'));
        binding = require(path.join(__dirname, '../../../prebuilds', `${process.platform}-${process.arch}`, 'secure_fs.node')) as NativeSecureFsBinding;
    });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('does not let a pre-created PID-derived staging name block publication', () => {
        const legacyStaging = path.join(root, `.sensors.json.secure-fs.tmp.${process.pid}`);
        fs.writeFileSync(legacyStaging, 'not ours');

        binding.writeProjectTransaction(root, 'sensors.json', Buffer.from('new bytes'), {
            mode: 'create', createParents: false,
        });

        expect(fs.readFileSync(path.join(root, 'sensors.json'), 'utf8')).toBe('new bytes');
        expect(fs.readFileSync(legacyStaging, 'utf8')).toBe('not ours');
    });
});

nativeOnly('native secure-fs project lease fixtures', () => {
    let root: string;
    let binding: NativeProjectLeaseBinding;
    const selectedArtifact = path.join(__dirname, '../../../prebuilds', `${process.platform}-${process.arch}`, 'secure_fs.node');

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-secure-fs-lease-'));
        binding = require(selectedArtifact) as NativeProjectLeaseBinding;
    });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('rejects a second AWM process before mutation, then admits it after release', () => {
        const target = path.join(root, 'owner.txt');
        fs.writeFileSync(target, 'owner bytes');
        const first = binding.acquireProjectLease(root);
        const claimant = `
            const fs = require('fs');
            const [artifact, projectRoot, target, content] = process.argv.slice(1);
            const binding = require(artifact);
            try {
                const lease = binding.acquireProjectLease(projectRoot);
                fs.writeFileSync(target, content);
                binding.releaseProjectLease(lease);
            } catch (error) {
                if (/project lease is already held/i.test(String(error && error.message))) process.exit(73);
                throw error;
            }
        `;

        const blocked = spawnSync(process.execPath, ['-e', claimant, selectedArtifact, root, target, 'claimant bytes'], { encoding: 'utf8' });
        expect(blocked.status).toBe(73);
        expect(fs.readFileSync(target, 'utf8')).toBe('owner bytes');

        binding.releaseProjectLease(first);
        const admitted = spawnSync(process.execPath, ['-e', claimant, selectedArtifact, root, target, 'claimant bytes'], { encoding: 'utf8' });
        expect(admitted).toMatchObject({ status: 0, signal: null });
        expect(fs.readFileSync(target, 'utf8')).toBe('claimant bytes');
        expect(fs.lstatSync(path.join(root, '.awm', '.secure-fs-lease')).isFile()).toBe(true);
    });

    it('uses an unforgeable native token and makes release idempotent', () => {
        const lease = binding.acquireProjectLease(root);
        expect(lease).toEqual(expect.any(Object));
        const releaseUnknown = binding.releaseProjectLease as (token: unknown) => void;
        for (const invalid of [{}, null, 1, 'lease']) {
            expect(() => releaseUnknown(invalid)).toThrow(/invalid.*lease token/i);
        }
        expect(() => binding.releaseProjectLease(lease)).not.toThrow();
        expect(() => binding.releaseProjectLease(lease)).not.toThrow();

        const next = binding.acquireProjectLease(root);
        binding.releaseProjectLease(next);
    });

    it('rejects a symlink or reparse-point .awm ancestor without touching its target', () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-secure-fs-lease-outside-'));
        try {
            fs.symlinkSync(outside, path.join(root, '.awm'), process.platform === 'win32' ? 'junction' : 'dir');
            expect(() => binding.acquireProjectLease(root)).toThrow(/rejected path ancestor|project lease/i);
            expect(fs.readdirSync(outside)).toEqual([]);
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    it('releases the OS-held lease automatically when its claimant process exits', () => {
        const claimant = `
            const binding = require(process.argv[1]);
            globalThis.lease = binding.acquireProjectLease(process.argv[2]);
        `;
        const exited = spawnSync(process.execPath, ['-e', claimant, selectedArtifact, root], { encoding: 'utf8' });
        expect(exited).toMatchObject({ status: 0, signal: null });

        const next = binding.acquireProjectLease(root);
        binding.releaseProjectLease(next);
    });
});

const windowsOnly = process.platform === 'win32' ? describe : describe.skip;

windowsOnly('native secure-fs Windows handle fixtures', () => {
    let root: string;
    let binding: NativeSecureFsBinding;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-secure-fs-win-'));
        // The CI build packages the current platform's artifact before Jest runs.
        binding = require(path.join(__dirname, '../../../prebuilds', `win32-${process.arch}`, 'secure_fs.node')) as NativeSecureFsBinding;
    });
    afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

    it('rejects a junction ancestor without creating a file in its target', () => {
        const outside = path.join(root, 'outside');
        const junction = path.join(root, 'junction');
        fs.mkdirSync(outside);
        fs.symlinkSync(outside, junction, 'junction');
        const target = path.join(junction, 'sensors.json');

        expect(() => binding.writeProjectTransaction(root, 'junction/sensors.json', Buffer.from('new bytes'), { mode: 'create', createParents: false })).toThrow(/rejected path ancestor/i);
        expect(fs.existsSync(path.join(outside, 'sensors.json'))).toBe(false);
    });

    it('rejects an existing target without mutating its bytes', () => {
        const target = path.join(root, 'sensors.json');
        fs.writeFileSync(target, 'existing bytes');

        expect(() => binding.writeProjectTransaction(root, 'sensors.json', Buffer.from('new bytes'), { mode: 'create', createParents: false })).toThrow(/target exists|transaction failed/i);
        expect(fs.readFileSync(target, 'utf8')).toBe('existing bytes');
    });

    it('rejects a stale replacement fence without changing a concurrent target', () => {
        const target = path.join(root, 'sensors.json');
        fs.writeFileSync(target, 'concurrent bytes');
        const observed = binding.readRegularFile(target, 1024);

        expect(() => binding.writeProjectTransaction(root, 'sensors.json', Buffer.from('new bytes'), {
            mode: 'replace', expected: Buffer.from('observed bytes'), expectedIdentity: observed.identity, createParents: false,
        })).toThrow(/original changed|transaction failed/i);
        expect(fs.readFileSync(target, 'utf8')).toBe('concurrent bytes');
    });

    it('replaces the exact observed target while its mandatory share fence remains open', () => {
        const target = path.join(root, 'sensors.json');
        fs.writeFileSync(target, 'observed bytes');
        const observed = binding.readRegularFile(target, 1024);

        binding.writeProjectTransaction(root, 'sensors.json', Buffer.from('new bytes'), {
            mode: 'replace', expected: observed.bytes, expectedIdentity: observed.identity, createParents: false,
        });

        expect(fs.readFileSync(target, 'utf8')).toBe('new bytes');
    });

    it('does not replace a same-byte target swapped after the exact native read', () => {
        const target = path.join(root, 'sensors.json');
        const original = path.join(root, 'original-sensors.json');
        fs.writeFileSync(target, 'observed bytes');
        const observed = binding.readRegularFile(target, 1024);
        fs.renameSync(target, original);
        fs.writeFileSync(target, 'observed bytes');

        expect(() => binding.writeProjectTransaction(root, 'sensors.json', Buffer.from('new bytes'), {
            mode: 'replace', expected: observed.bytes, expectedIdentity: observed.identity, createParents: false,
        })).toThrow(/original changed|transaction failed/i);
        expect(fs.readFileSync(target, 'utf8')).toBe('observed bytes');
        expect(fs.readFileSync(original, 'utf8')).toBe('observed bytes');
    });

    it('creates missing safe parent components before publishing', () => {
        binding.writeProjectTransaction(root, '.awm/assets/eslint.config.awm.mjs', Buffer.from('new bytes'), { mode: 'create', createParents: true });
        expect(fs.readFileSync(path.join(root, '.awm', 'assets', 'eslint.config.awm.mjs'), 'utf8')).toBe('new bytes');
    });

    it('never follows a junction swapped into a checked parent', async () => {
        const trusted = path.join(root, 'trusted');
        const parked = path.join(root, 'parked');
        const outside = path.join(root, 'outside');
        fs.mkdirSync(trusted);
        fs.mkdirSync(outside);
        const shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
        const state = new Int32Array(shared);
        const worker = new Worker(`
            const fs = require('fs');
            const { parentPort, workerData } = require('worker_threads');
            const state = new Int32Array(workerData.shared);
            const restore = () => {
                try {
                    if (fs.lstatSync(workerData.trusted).isSymbolicLink()) fs.rmSync(workerData.trusted);
                } catch {}
                try {
                    if (!fs.existsSync(workerData.trusted) && fs.existsSync(workerData.parked)) {
                        fs.renameSync(workerData.parked, workerData.trusted);
                    }
                } catch {}
            };
            while (Atomics.load(state, 0) === 0) {
                try {
                    fs.renameSync(workerData.trusted, workerData.parked);
                    fs.symlinkSync(workerData.outside, workerData.trusted, 'junction');
                    Atomics.add(state, 1, 1);
                    Atomics.notify(state, 1);
                    Atomics.wait(state, 0, 0, 1);
                    fs.rmSync(workerData.trusted);
                    fs.renameSync(workerData.parked, workerData.trusted);
                    Atomics.wait(state, 0, 0, 1);
                } catch {
                    restore();
                }
            }
            restore();
            parentPort.postMessage('done');
            `, { eval: true, workerData: { shared, trusted, parked, outside } });
        const done = new Promise<void>((resolve, reject) => {
            worker.once('message', () => resolve());
            worker.once('error', reject);
        });

        let published = 0;
        try {
            Atomics.wait(state, 1, 0, 5_000);
            expect(Atomics.load(state, 1)).toBeGreaterThan(0);
            for (let attempt = 0; attempt < 500; attempt += 1) {
                try {
                    binding.writeProjectTransaction(root, `trusted/sensors-${attempt}.json`, Buffer.from('new bytes'), {
                        mode: 'create', createParents: false,
                    });
                    published += 1;
                } catch (error) {
                    expect(error).toEqual(expect.any(Error));
                }
            }
        } finally {
            Atomics.store(state, 0, 1);
            Atomics.notify(state, 0);
            await done;
        }

        expect(Atomics.load(state, 1)).toBeGreaterThan(0);
        expect(published).toBeGreaterThan(0);
        expect(fs.readdirSync(outside)).toEqual([]);
    }, 30_000);
});
