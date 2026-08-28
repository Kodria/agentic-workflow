import fs from 'fs';
import path from 'path';

export type NativeSecureFsBinding = Readonly<{
    readRegularFile(file: string, maxBytes: number): Buffer;
    writeProjectTransaction(file: string, content: Buffer): void;
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
        || typeof (loaded as Partial<NativeSecureFsBinding>).readRegularFile !== 'function'
        || typeof (loaded as Partial<NativeSecureFsBinding>).writeProjectTransaction !== 'function') {
        throw new Error(`secure-fs native artifact is incompatible for ${status.platform}-${status.arch}`);
    }
    return loaded as NativeSecureFsBinding;
}

export type SecureFsBoundary = Readonly<{
    readRegularFile(file: string, maxBytes: number): Buffer;
    writeProjectTransaction(file: string, content: Buffer): void;
}>;

function absoluteFile(value: unknown, label: string): string {
    if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value) throw new Error(`${label} must be an absolute normalized path`);
    return value;
}

function boundedBytes(value: unknown, label: string): Buffer {
    if (!Buffer.isBuffer(value)) throw new Error(`${label} must be a Buffer`);
    return value;
}

function positiveSafeInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive safe integer`);
    return value as number;
}

export function createSecureFsBoundary(load: () => NativeSecureFsBinding): SecureFsBoundary {
    return Object.freeze({
        readRegularFile(file: string, maxBytes: number): Buffer {
            const result = load().readRegularFile(absoluteFile(file, 'file'), positiveSafeInteger(maxBytes, 'maxBytes'));
            if (!Buffer.isBuffer(result)) throw new Error('secure-fs native bridge returned invalid read bytes');
            return result;
        },
        writeProjectTransaction(file: string, content: Buffer): void {
            load().writeProjectTransaction(absoluteFile(file, 'file'), boundedBytes(content, 'content'));
        },
    });
}

const packageRoot = path.resolve(__dirname, '..', '..', '..');
export const secureFs = createSecureFsBoundary(() => loadNativeSecureFsBridge({
    root: packageRoot,
    platform: process.platform,
    arch: process.arch,
    load: artifact => require(artifact) as NativeSecureFsBinding,
}));
