import fs from 'fs';

export type SafeFileFailure = 'open' | 'regular' | 'identity' | 'size' | 'limit';

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
