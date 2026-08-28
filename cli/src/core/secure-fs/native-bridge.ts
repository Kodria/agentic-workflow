import fs from 'fs';
import path from 'path';

export type NativeSecureFsBinding = Readonly<{
    acquireProjectLease(projectRoot: string): object;
    releaseProjectLease(token: object): void;
    readRegularFile(file: string, maxBytes: number): NativeReadResult;
    writeProjectTransaction(projectRoot: string, destination: string, content: Buffer, options: NativeWriteOptions): void;
    removeObservedProjectFile(projectRoot: string, destination: string, identity: Buffer): void;
}>;

export type NativeReadResult = Readonly<{
    bytes: Buffer;
    /** Fixed-format native identity token; never constructed from a pathname. */
    identity: Buffer;
}>;

export type NativeWriteOptions = Readonly<{
    mode: 'create';
    createParents: boolean;
    expected?: never;
    expectedIdentity?: never;
} | {
    mode: 'replace';
    createParents: boolean;
    expected: Buffer;
    expectedIdentity: Buffer;
}>;

declare const fileIdentityTokenBrand: unique symbol;
export type FileIdentityToken = Readonly<{ [fileIdentityTokenBrand]: true }>;

export type SecureFileRead = Readonly<{
    bytes: Buffer;
    identity: FileIdentityToken;
}>;

export type SecureWriteOptions = Readonly<{
    mode: 'create';
    createParents: boolean;
    expected?: never;
    expectedIdentity?: never;
} | {
    mode: 'replace';
    createParents: boolean;
    expected: Buffer;
    expectedIdentity: FileIdentityToken;
}>;

export type NativeArtifactStatus = Readonly<{
    status: 'available' | 'missing';
    platform: NodeJS.Platform;
    arch: string;
    path: string;
}>;

type LoaderOptions = Readonly<{
    root: string;
    platform: NodeJS.Platform;
    arch: string;
    load: (artifact: string) => NativeSecureFsBinding;
}>;

const supportedPlatforms = new Set<NodeJS.Platform>(['linux', 'darwin', 'win32']);
const supportedArchitectures = new Set(['x64', 'arm64']);

function artifactPath(root: string, platform: NodeJS.Platform, arch: string): string {
    if (!supportedPlatforms.has(platform) || !supportedArchitectures.has(arch)) {
        throw new Error(`secure-fs native bridge does not support ${platform}-${arch}`);
    }
    return path.join(root, 'prebuilds', `${platform}-${arch}`, 'secure_fs.node');
}

export function nativeArtifactStatus(options: Omit<LoaderOptions, 'load'>): NativeArtifactStatus {
    const artifact = artifactPath(options.root, options.platform, options.arch);
    return { status: fs.existsSync(artifact) ? 'available' : 'missing', platform: options.platform, arch: options.arch, path: artifact };
}

export function loadNativeSecureFsBridge(options: LoaderOptions): NativeSecureFsBinding {
    const status = nativeArtifactStatus(options);
    if (status.status !== 'available') throw new Error(`secure-fs native artifact is unavailable for ${status.platform}-${status.arch}`);
    let loaded: unknown;
    try { loaded = options.load(status.path); }
    catch { throw new Error(`secure-fs native artifact is incompatible for ${status.platform}-${status.arch}`); }
    if (!loaded || typeof loaded !== 'object'
        || typeof (loaded as Partial<NativeSecureFsBinding>).acquireProjectLease !== 'function'
        || typeof (loaded as Partial<NativeSecureFsBinding>).releaseProjectLease !== 'function'
        || typeof (loaded as Partial<NativeSecureFsBinding>).readRegularFile !== 'function'
        || typeof (loaded as Partial<NativeSecureFsBinding>).writeProjectTransaction !== 'function'
        || typeof (loaded as Partial<NativeSecureFsBinding>).removeObservedProjectFile !== 'function') {
        throw new Error(`secure-fs native artifact is incompatible for ${status.platform}-${status.arch}`);
    }
    return loaded as NativeSecureFsBinding;
}

export type SecureFsBoundary = Readonly<{
    withProjectLease<T>(projectRoot: string, operation: () => T): T;
    readRegularFile(file: string, maxBytes: number): SecureFileRead;
    writeProjectTransaction(projectRoot: string, destination: string, content: Buffer, options: SecureWriteOptions): void;
    removeObservedProjectFile(projectRoot: string, destination: string, identity: FileIdentityToken): void;
}>;

const IDENTITY_TOKEN_BYTES = 24;
const NATIVE_DESTINATION_EXISTS_CODE = 'AWM_SECURE_FS_DESTINATION_EXISTS';
export const PROJECT_DESTINATION_ALREADY_EXISTS_MESSAGE = 'project destination already exists';
const identityObservations = new WeakMap<object, Readonly<{ file: string; bytes: Buffer; identity: Buffer }>>();

function absoluteFile(value: unknown, label: string): string {
    if (typeof value === 'string' && value.includes('\0')) throw new Error(`${label} must not contain a NUL byte`);
    if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value) throw new Error(`${label} must be an absolute normalized path`);
    return value;
}

function isNativeDestinationExistsError(error: unknown): boolean {
    return !!error && typeof error === 'object'
        && (error as { code?: unknown }).code === NATIVE_DESTINATION_EXISTS_CODE;
}

function boundedBytes(value: unknown, label: string): Buffer {
    if (!Buffer.isBuffer(value)) throw new Error(`${label} must be a Buffer`);
    return value;
}

function projectDestination(value: unknown): string {
    if (typeof value !== 'string' || !value || value.includes('\\')
        || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
        throw new Error('destination must be a canonical project-relative path');
    }
    const components = value.split('/');
    if (components.some(component => !component || component === '.' || component === '..' || component.includes(':') || component.includes('\0'))) {
        throw new Error('destination must contain only safe project-relative components');
    }
    return components.join(path.sep);
}

function positiveSafeInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive safe integer`);
    return value as number;
}

function nativeIdentity(value: unknown): Buffer {
    if (!Buffer.isBuffer(value) || value.length !== IDENTITY_TOKEN_BYTES
        || value.toString('ascii', 0, 4) !== 'SFSI' || value[4] !== 1
        || (value[5] !== 1 && value[5] !== 2) || value[6] !== 0 || value[7] !== 0) {
        throw new Error('secure-fs native bridge returned invalid read identity');
    }
    const expectedKind = process.platform === 'win32' ? 2 : 1;
    if (value[5] !== expectedKind) throw new Error('secure-fs native bridge returned identity for the wrong platform');
    return Buffer.from(value);
}

function secureReadResult(file: string, value: unknown): SecureFileRead {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('secure-fs native bridge returned invalid read result');
    const candidate = value as Partial<NativeReadResult>;
    if (!Buffer.isBuffer(candidate.bytes)) throw new Error('secure-fs native bridge returned invalid read bytes');
    const bytes = Buffer.from(candidate.bytes);
    const token = Object.freeze({}) as FileIdentityToken;
    identityObservations.set(token, { file, bytes: Buffer.from(bytes), identity: nativeIdentity(candidate.identity) });
    return Object.freeze({ bytes, identity: token });
}

function writeOptions(value: unknown): NativeWriteOptions {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('transaction options must be an object');
    const candidate = value as Partial<SecureWriteOptions>;
    if (candidate.mode !== 'create' && candidate.mode !== 'replace') throw new Error('transaction mode must be create or replace');
    if (typeof candidate.createParents !== 'boolean') throw new Error('transaction createParents must be boolean');
    if (candidate.mode === 'create') {
        if (candidate.expected !== undefined || candidate.expectedIdentity !== undefined) throw new Error('create transaction cannot have replacement expectations');
        return { mode: 'create', createParents: candidate.createParents };
    }
    if (!Buffer.isBuffer(candidate.expected)) throw new Error('replace transaction requires expected Buffer bytes');
    if (!candidate.expectedIdentity || typeof candidate.expectedIdentity !== 'object') throw new Error('replace transaction requires expected identity token');
    const observation = identityObservations.get(candidate.expectedIdentity);
    if (!observation) throw new Error('replace transaction requires an opaque identity token from readRegularFile');
    if (!candidate.expected.equals(observation.bytes)) throw new Error('replace expected bytes do not match the identity observation');
    return {
        mode: 'replace',
        expected: Buffer.from(observation.bytes),
        expectedIdentity: Buffer.from(observation.identity),
        createParents: candidate.createParents,
    };
}

export function createSecureFsBoundary(load: () => NativeSecureFsBinding): SecureFsBoundary {
    return Object.freeze({
        withProjectLease<T>(projectRoot: string, operation: () => T): T {
            const validatedRoot = absoluteFile(projectRoot, 'projectRoot');
            if (typeof operation !== 'function') throw new Error('project lease operation must be a function');
            const binding = load();
            let token: object;
            try { token = binding.acquireProjectLease(validatedRoot); }
            catch (error) {
                const message = String(error);
                if (message.includes('project lease is already held')) throw new Error('project lease conflict');
                if (message.includes('rejected path ancestor')) throw new Error('project destination is unsafe for lease');
                throw new Error('project lease acquisition failed');
            }
            if (!token || typeof token !== 'object' || Array.isArray(token)) {
                throw new Error('secure-fs native bridge returned invalid project lease token');
            }
            try { return operation(); }
            finally { binding.releaseProjectLease(token); }
        },
        readRegularFile(file: string, maxBytes: number): SecureFileRead {
            const validatedFile = absoluteFile(file, 'file');
            const validatedMaxBytes = positiveSafeInteger(maxBytes, 'maxBytes');
            const result = load().readRegularFile(validatedFile, validatedMaxBytes);
            return secureReadResult(validatedFile, result);
        },
        writeProjectTransaction(projectRoot: string, destination: string, content: Buffer, options: SecureWriteOptions): void {
            const validatedRoot = absoluteFile(projectRoot, 'projectRoot');
            const validatedDestination = projectDestination(destination);
            const validatedContent = boundedBytes(content, 'content');
            const validatedOptions = writeOptions(options);
            try {
                load().writeProjectTransaction(validatedRoot, validatedDestination, validatedContent, validatedOptions);
            } catch (error) {
                if (isNativeDestinationExistsError(error)) throw new Error(PROJECT_DESTINATION_ALREADY_EXISTS_MESSAGE);
                throw error;
            }
        },
        removeObservedProjectFile(projectRoot: string, destination: string, identity: FileIdentityToken): void {
            const validatedRoot = absoluteFile(projectRoot, 'projectRoot');
            const validatedDestination = projectDestination(destination);
            if (!identity || typeof identity !== 'object') throw new Error('remove requires an opaque identity token from readRegularFile');
            const observation = identityObservations.get(identity);
            if (!observation) throw new Error('remove requires an opaque identity token from readRegularFile');
            const observedDestination = path.join(validatedRoot, validatedDestination);
            if (observation.file !== observedDestination) throw new Error('remove requires the exact observed destination');
            load().removeObservedProjectFile(validatedRoot, validatedDestination, Buffer.from(observation.identity));
        },
    });
}

export function resolvePackageRoot(moduleDirectory: string): string {
    const sourceLayout = path.resolve(moduleDirectory, '..', '..', '..');
    return fs.existsSync(path.join(sourceLayout, 'package.json'))
        ? sourceLayout
        : path.resolve(sourceLayout, '..');
}

const packageRoot = resolvePackageRoot(__dirname);
export const secureFs = createSecureFsBoundary(() => loadNativeSecureFsBridge({
    root: packageRoot,
    platform: process.platform,
    arch: process.arch,
    load: artifact => require(artifact) as NativeSecureFsBinding,
}));
