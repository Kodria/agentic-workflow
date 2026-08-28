import fs from 'fs';
import path from 'path';

export type SafeFileFailure = 'open' | 'regular' | 'identity' | 'size' | 'limit';

type DirectorySnapshot = { name: string; stat: fs.BigIntStats };

function sameIdentity(left: fs.BigIntStats, right: fs.BigIntStats): boolean {
    return left.dev === right.dev && left.ino === right.ino;
}

function snapshotDirectoryChain(directory: string, failure: () => Error): DirectorySnapshot[] {
    if (!path.isAbsolute(directory)) throw failure();
    const resolved = path.resolve(directory);
    const parsed = path.parse(resolved);
    const snapshots: DirectorySnapshot[] = [];
    let current = parsed.root;
    for (const component of ['', ...path.relative(parsed.root, resolved).split(path.sep).filter(Boolean)]) {
        if (component) current = path.join(current, component);
        let stat: fs.BigIntStats;
        try { stat = fs.lstatSync(current, { bigint: true }); }
        catch { throw failure(); }
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure();
        snapshots.push({ name: current, stat });
    }
    return snapshots;
}

function assertDirectoryChainUnchanged(snapshots: readonly DirectorySnapshot[], failure: () => Error): void {
    for (const snapshot of snapshots) {
        let current: fs.BigIntStats;
        try { current = fs.lstatSync(snapshot.name, { bigint: true }); }
        catch { throw failure(); }
        if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, snapshot.stat)) throw failure();
    }
}

function withPortableValidatedDirectory<T>(directory: string, failure: () => Error, operation: (boundDirectory: string) => T): T {
    const snapshots = snapshotDirectoryChain(directory, failure);
    let result: T | undefined;
    let operationError: unknown;
    try { result = operation(directory); }
    catch (error) { operationError = error; }
    assertDirectoryChainUnchanged(snapshots, failure);
    if (operationError !== undefined) throw operationError;
    return result as T;
}

function procfsDescriptorBridgeAvailable(): boolean {
    try { return process.platform === 'linux' && fs.statSync('/proc/self/fd').isDirectory(); }
    catch { return false; }
}

function withOpenedNoFollowDirectory<T>(open: () => number, failure: () => Error, operation: (boundDirectory: string) => T): T {
    let descriptor: number | undefined;
    try {
        descriptor = open();
        const opened = fs.fstatSync(descriptor, { bigint: true });
        if (!opened.isDirectory()) throw failure();
        return operation(`/proc/self/fd/${descriptor}`);
    } catch {
        throw failure();
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* best effort descriptor cleanup */ }
        }
    }
}

/**
 * Bind a directory without following an observable symlink. Linux uses a
 * descriptor path so ancestor renames cannot redirect work. Other platforms
 * validate every component and its identity before and after the operation;
 * Node exposes no portable openat equivalent, so any observable change fails
 * closed rather than being accepted as a pathname race.
 */
export function withNoFollowDirectory<T>(directory: string, failure: () => Error, operation: (boundDirectory: string) => T): T {
    const noFollow = fs.constants.O_NOFOLLOW;
    const directoryFlag = fs.constants.O_DIRECTORY;
    if (!path.isAbsolute(directory)) throw failure();
    if (typeof noFollow !== 'number' || typeof directoryFlag !== 'number' || !procfsDescriptorBridgeAvailable()) {
        return withPortableValidatedDirectory(directory, failure, operation);
    }
    let descriptor: number | undefined;
    try {
        const parsed = path.parse(directory);
        descriptor = fs.openSync(parsed.root, fs.constants.O_RDONLY | noFollow | directoryFlag);
        const relative = path.relative(parsed.root, path.resolve(directory));
        for (const component of relative.split(path.sep).filter(Boolean)) {
            const next = fs.openSync(`/proc/self/fd/${descriptor}/${component}`, fs.constants.O_RDONLY | noFollow | directoryFlag);
            fs.closeSync(descriptor);
            descriptor = next;
        }
        const finalDescriptor = descriptor;
        descriptor = undefined;
        return withOpenedNoFollowDirectory(() => finalDescriptor, failure, operation);
    } catch {
        throw failure();
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed during a failed handoff */ }
        }
    }
}

/**
 * Run a filesystem mutation only through a descriptor-bound directory path.
 * Identity snapshots are sufficient for bounded reads, but cannot make a
 * pathname write safe: a parent can be replaced after the snapshot and before
 * `mkdtemp`, staging, or publication. Platforms without the Linux descriptor
 * bridge therefore reject before the mutation callback begins.
 */
export function withDescriptorBoundWriteDirectory<T>(directory: string, failure: () => Error, operation: (boundDirectory: string) => T): T {
    const noFollow = fs.constants.O_NOFOLLOW;
    const directoryFlag = fs.constants.O_DIRECTORY;
    if (typeof noFollow !== 'number' || typeof directoryFlag !== 'number' || !procfsDescriptorBridgeAvailable()) throw failure();
    return withNoFollowDirectory(directory, failure, operation);
}

/** Open one direct child from a previously bound directory without path re-resolution. */
export function withNoFollowChildDirectory<T>(parentDirectory: string, component: string, failure: () => Error, operation: (boundDirectory: string) => T): T {
    const noFollow = fs.constants.O_NOFOLLOW;
    const directoryFlag = fs.constants.O_DIRECTORY;
    if (!component || component === '.' || component === '..' || /[\\/]/.test(component)) throw failure();
    if (typeof noFollow !== 'number' || typeof directoryFlag !== 'number' || !procfsDescriptorBridgeAvailable()) {
        return withPortableValidatedDirectory(path.join(parentDirectory, component), failure, operation);
    }
    return withOpenedNoFollowDirectory(
        () => fs.openSync(path.join(parentDirectory, component), fs.constants.O_RDONLY | noFollow | directoryFlag),
        failure,
        operation,
    );
}

/** Read the exact regular file that was previously inspected. */
export function readInspectedBoundedFile(file: string, inspected: fs.BigIntStats, maxBytes: number, failure: (reason: SafeFileFailure) => Error): Buffer {
    const noFollow = fs.constants.O_NOFOLLOW;
    const directorySnapshots = typeof noFollow === 'number' && procfsDescriptorBridgeAvailable()
        ? undefined
        : snapshotDirectoryChain(path.dirname(file), () => failure('identity'));
    let descriptor: number;
    try { descriptor = fs.openSync(file, fs.constants.O_RDONLY | (typeof noFollow === 'number' ? noFollow : 0)); }
    catch { throw failure('open'); }
    try {
        let opened: fs.BigIntStats;
        try { opened = fs.fstatSync(descriptor, { bigint: true }); }
        catch { throw failure('identity'); }
        if (!opened.isFile()) throw failure('regular');
        if (!sameIdentity(opened, inspected)) throw failure('identity');
        if (opened.size !== inspected.size) throw failure('size');
        const limit = BigInt(maxBytes);
        if (opened.size > limit) throw failure('limit');
        const buffer = Buffer.allocUnsafe(maxBytes + 1);
        const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
        if (!Number.isSafeInteger(count) || count < 0 || count > maxBytes) throw failure('limit');
        if (BigInt(count) !== opened.size) throw failure('size');
        const after = fs.fstatSync(descriptor, { bigint: true });
        if (!after.isFile() || !sameIdentity(after, opened)) throw failure('identity');
        if (after.size !== opened.size) throw failure('size');
        if (directorySnapshots) assertDirectoryChainUnchanged(directorySnapshots, () => failure('identity'));
        return buffer.subarray(0, count);
    } finally { fs.closeSync(descriptor); }
}
