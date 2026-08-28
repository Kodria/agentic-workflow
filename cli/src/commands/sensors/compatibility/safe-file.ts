import fs from 'fs';
import path from 'path';

export type SafeFileFailure = 'open' | 'regular' | 'identity' | 'size' | 'limit';

/**
 * Bind an existing directory to a descriptor reached without following any
 * component symlink. Calls receive a procfs descriptor path, so a later rename
 * of a pathname ancestor cannot redirect a staging or publication write.
 * Node has no openat API; fail closed where its Linux descriptor bridge is not
 * available rather than silently falling back to racy string paths.
 */
function withOpenedNoFollowDirectory<T>(open: () => number, failure: () => Error, operation: (boundDirectory: string) => T): T {
    let descriptor: number | undefined;
    try {
        descriptor = open();
        const opened = fs.fstatSync(descriptor);
        if (!opened.isDirectory()) throw failure();
    } catch {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* best effort after failed validation */ }
        }
        throw failure();
    }
    try {
        return operation(`/proc/self/fd/${descriptor}`);
    } finally {
        try { fs.closeSync(descriptor); } catch { /* best effort descriptor cleanup */ }
    }
}

export function withNoFollowDirectory<T>(directory: string, failure: () => Error, operation: (boundDirectory: string) => T): T {
    const noFollow = fs.constants.O_NOFOLLOW;
    const directoryFlag = fs.constants.O_DIRECTORY;
    if (!path.isAbsolute(directory) || typeof noFollow !== 'number' || typeof directoryFlag !== 'number') throw failure();
    let descriptor: number | undefined;
    try {
        descriptor = fs.openSync(path.parse(directory).root, fs.constants.O_RDONLY | noFollow | directoryFlag);
        const relative = path.relative(path.parse(directory).root, path.resolve(directory));
        for (const component of relative.split(path.sep).filter(Boolean)) {
            const next = fs.openSync(`/proc/self/fd/${descriptor}/${component}`, fs.constants.O_RDONLY | noFollow | directoryFlag);
            fs.closeSync(descriptor);
            descriptor = next;
        }
        const bound = `/proc/self/fd/${descriptor}`;
        const finalDescriptor = descriptor;
        descriptor = undefined;
        return withOpenedNoFollowDirectory(() => finalDescriptor, failure, operation.bind(undefined, bound));
    } catch {
        throw failure();
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed during a failed handoff */ }
        }
    }
}

/** Open one direct child from a previously bound directory without path re-resolution. */
export function withNoFollowChildDirectory<T>(parentDirectory: string, component: string, failure: () => Error, operation: (boundDirectory: string) => T): T {
    const noFollow = fs.constants.O_NOFOLLOW;
    const directoryFlag = fs.constants.O_DIRECTORY;
    if (!component || component === '.' || component === '..' || /[\\/]/.test(component)
        || typeof noFollow !== 'number' || typeof directoryFlag !== 'number') throw failure();
    return withOpenedNoFollowDirectory(
        () => fs.openSync(path.join(parentDirectory, component), fs.constants.O_RDONLY | noFollow | directoryFlag),
        failure,
        operation,
    );
}

/**
 * Read the exact regular file that was previously inspected. POSIX gets
 * O_NOFOLLOW; platforms that do not expose it (notably Windows) compare the
 * bigint device/inode identity and size across open. Bigints avoid losing the
 * high bits of Windows file IDs.
 */
export function readInspectedBoundedFile(
    file: string,
    inspected: fs.BigIntStats,
    maxBytes: number,
    failure: (reason: SafeFileFailure) => Error,
): Buffer {
    const noFollow = fs.constants.O_NOFOLLOW;
    let descriptor: number;
    try {
        descriptor = fs.openSync(file, fs.constants.O_RDONLY | (typeof noFollow === 'number' ? noFollow : 0));
    } catch {
        throw failure('open');
    }
    try {
        let opened: fs.BigIntStats;
        try {
            opened = fs.fstatSync(descriptor, { bigint: true });
        } catch {
            throw failure('identity');
        }
        if (!opened.isFile()) throw failure('regular');
        if (opened.dev !== inspected.dev || opened.ino !== inspected.ino) throw failure('identity');
        if (opened.size !== inspected.size) throw failure('size');
        const limit = BigInt(maxBytes);
        if (opened.size > limit) throw failure('limit');
        const buffer = Buffer.allocUnsafe(maxBytes + 1);
        const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
        if (!Number.isSafeInteger(count) || count < 0 || count > maxBytes) throw failure('limit');
        if (BigInt(count) !== opened.size) throw failure('size');
        return buffer.subarray(0, count);
    } finally {
        fs.closeSync(descriptor);
    }
}
