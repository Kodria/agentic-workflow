import { runCompatibilityProbe } from '../../../../src/commands/sensors/compatibility/probe';

const fakeExecutor: jest.Mock<any, any> = jest.fn(async () => ({ code: 0, signal: null, timedOut: false, overflowed: false, stdout: 'SECRET_VALUE\nmatched', stderr: '' }));
const evidence = { cwd: process.cwd(), configFiles: ['eslint.config.js'], scripts: ['lint'] } as any;

describe('runCompatibilityProbe', () => {
    beforeEach(() => fakeExecutor.mockClear());

    test.each(['eslint-print-config', 'typescript-show-config', 'semgrep-validate', 'version', 'package-script-present', 'config-present'] as const)
        ('runs the closed probe %s with sanitized output', async (kind) => {
            const result = await runCompatibilityProbe({ kind }, evidence, fakeExecutor);
            expect(['matched', 'unverifiable']).toContain(result.status);
            expect(JSON.stringify(result)).not.toContain('SECRET_VALUE');
        });

    it('never treats a timeout or overflow as a match', async () => {
        fakeExecutor.mockResolvedValueOnce({ code: null, signal: 'SIGKILL', timedOut: true, overflowed: false, stdout: '', stderr: '' });
        await expect(runCompatibilityProbe({ kind: 'version' }, evidence, fakeExecutor)).resolves.toMatchObject({ status: 'unverifiable' });
        fakeExecutor.mockResolvedValueOnce({ code: 0, signal: null, timedOut: false, overflowed: true, stdout: 'ok', stderr: '' });
        await expect(runCompatibilityProbe({ kind: 'version' }, evidence, fakeExecutor)).resolves.toMatchObject({ status: 'unverifiable' });
    });

    it('binds tool probes to the project node_modules executable instead of PATH', async () => {
        await runCompatibilityProbe({ kind: 'eslint-print-config' }, evidence, fakeExecutor);

        expect(fakeExecutor).toHaveBeenCalledWith(
            expect.objectContaining({ executable: 'eslint', resolution: 'node-modules-bin' }),
            expect.any(Object),
        );
    });

    it('propagates the selected ESLint mode to its compatibility probe', async () => {
        await runCompatibilityProbe({ kind: 'eslint-print-config' }, {
            ...evidence,
            toolExecutable: 'eslint',
            toolResolution: 'node-modules-bin',
            environment: { ESLINT_USE_FLAT_CONFIG: 'true' },
        }, fakeExecutor);

        expect(fakeExecutor).toHaveBeenCalledWith(
            expect.objectContaining({ environment: { ESLINT_USE_FLAT_CONFIG: 'true' } }),
            expect.any(Object),
        );
    });

    it('binds Semgrep validation to the contained Python environment', async () => {
        await runCompatibilityProbe({ kind: 'semgrep-validate' }, evidence, fakeExecutor);

        expect(fakeExecutor).toHaveBeenCalledWith(
            expect.objectContaining({ executable: 'semgrep', resolution: 'python-environment' }),
            expect.any(Object),
        );
    });

    it('keeps Windows Semgrep validation on the discovered .venv executable', async () => {
        await runCompatibilityProbe({ kind: 'semgrep-validate' }, {
            cwd: process.cwd(), toolExecutable: 'semgrep', toolResolution: 'python-environment', pythonEnvironmentRoot: '.venv',
        }, fakeExecutor);

        expect(fakeExecutor).toHaveBeenCalledWith(
            { executable: 'semgrep', resolution: 'python-environment', pythonEnvironmentRoot: '.venv', args: ['--validate'] },
            expect.objectContaining({ cwd: process.cwd() }),
        );
    });

    it.each(['mypy', 'ruff', 'pytest'])('probes a %s variant through the contained Python environment', async (toolExecutable) => {
        await runCompatibilityProbe({ kind: 'version' }, { ...evidence, toolExecutable, toolResolution: 'python-environment' }, fakeExecutor);

        expect(fakeExecutor).toHaveBeenCalledWith(
            expect.objectContaining({ executable: toolExecutable, resolution: 'python-environment', args: ['--version'] }),
            expect.any(Object),
        );
    });
});
