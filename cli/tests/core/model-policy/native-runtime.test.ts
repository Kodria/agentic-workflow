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
});
