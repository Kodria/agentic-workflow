import fs from 'fs';
import { queryRuntimeExecutable } from '../../../src/core/model-policy/native-runtime';

describe('native runtime fingerprint', () => {
    it('binds reported version and executable content without launching inference', async () => {
        const result = await queryRuntimeExecutable({ command: process.execPath, args: ['--version'], timeoutMs: 5000 });
        expect(result).toMatchObject({ version: expect.stringMatching(/^\d+\.\d+\.\d+$/), binaryDigest: expect.stringMatching(/^[a-f0-9]{64}$/), inferenceDispatched: false });
        expect(await queryRuntimeExecutable({ command: process.execPath, args: ['--version'], timeoutMs: 5000 })).toEqual(result);
    });

    it('rejects an invalid binary or an inference-shaped invocation', async () => {
        await expect(queryRuntimeExecutable({ command: '/definitely/missing/awm-runtime', args: ['--version'], timeoutMs: 1000 })).rejects.toThrow(/runtime|executable/i);
        await expect(queryRuntimeExecutable({ command: process.execPath, args: ['-e', 'console.log(1)'], timeoutMs: 1000 })).rejects.toThrow(/version/i);
    });

    it('rejects hashing when high-bit inodes collide as Number but differ as BigInt (RF-1.7)', async () => {
        const inoA = (1n << 63n) + 92n;
        const inoB = (1n << 63n) + 900n;
        expect(Number(inoA) === Number(inoB)).toBe(true);
        let hits = 0;
        const real = fs.statSync.bind(fs);
        const spy = jest.spyOn(fs, 'statSync').mockImplementation(((p: fs.PathLike, opts?: { bigint?: boolean }) => {
            if (opts && opts.bigint === true) {
                hits += 1;
                const base = real(p, { bigint: true });
                return Object.assign(Object.create(Object.getPrototypeOf(base)), base, { ino: hits === 1 ? inoA : inoB });
            }
            const base = real(p);
            // Number path: both phases collide so today's hashFile would accept the swap.
            return Object.assign(Object.create(Object.getPrototypeOf(base)), base, { ino: Number(hits === 0 ? inoA : inoB) });
        }) as unknown as typeof fs.statSync);
        try {
            await expect(queryRuntimeExecutable({ command: process.execPath, args: ['--version'], timeoutMs: 5000 }))
                .rejects.toThrow(/changed while hashing/i);
        } finally {
            spy.mockRestore();
        }
    });

    it('rejects hashing when before/after inodes are both unobservable zero (RF-1.7)', async () => {
        // Kill: without isObservableInode guards, 0n===0n would accept the hash.
        const real = fs.statSync.bind(fs);
        const spy = jest.spyOn(fs, 'statSync').mockImplementation(((p: fs.PathLike, opts?: { bigint?: boolean }) => {
            if (opts && opts.bigint === true) {
                const base = real(p, { bigint: true });
                return Object.assign(Object.create(Object.getPrototypeOf(base)), base, { ino: 0n });
            }
            const base = real(p);
            return Object.assign(Object.create(Object.getPrototypeOf(base)), base, { ino: 0 });
        }) as unknown as typeof fs.statSync);
        try {
            await expect(queryRuntimeExecutable({ command: process.execPath, args: ['--version'], timeoutMs: 5000 }))
                .rejects.toThrow(/changed while hashing|invalid/i);
        } finally {
            spy.mockRestore();
        }
    });
});
