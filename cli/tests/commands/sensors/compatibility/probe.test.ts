import { runCompatibilityProbe } from '../../../../src/commands/sensors/compatibility/probe';
import type { ExecResult } from '../../../../src/commands/sensors/exec';

const execResult = (overrides: Partial<ExecResult> = {}): ExecResult => ({
    code: 0,
    signal: null,
    timedOut: false,
    overflowed: false,
    elapsedMs: 0,
    stdout: 'SECRET_VALUE\nmatched',
    stderr: '',
    ...overrides,
});
const fakeExecutor = jest.fn<Promise<ExecResult>, [unknown, unknown]>(async () => execResult());
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
        fakeExecutor.mockResolvedValueOnce(execResult({ code: null, signal: 'SIGKILL', timedOut: true, stdout: '' }));
        await expect(runCompatibilityProbe({ kind: 'version' }, evidence, fakeExecutor)).resolves.toMatchObject({ status: 'unverifiable' });
        fakeExecutor.mockResolvedValueOnce(execResult({ overflowed: true, stdout: 'ok' }));
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

    // A pack asset is never named the tool's own default (e.g. `eslint.config.awm.mjs`,
    // not `eslint.config.js`) so the real command always pins it via `--config`. A probe
    // that omits the same flag never finds a config to load and always reports
    // not-matched — a false negative on every AWM-configured project. The probe must
    // mirror the variant's own `--config` argument, not guess a bare invocation.
    it('carries the variant\'s --config argument into an eslint-print-config probe', async () => {
        await runCompatibilityProbe({ kind: 'eslint-print-config' }, {
            ...evidence, variantArgs: ['.', '--config', 'eslint.config.awm.mjs', '--cache', '--format', 'json'],
        }, fakeExecutor);

        expect(fakeExecutor).toHaveBeenCalledWith(
            expect.objectContaining({ args: ['--config', 'eslint.config.awm.mjs', '--print-config', 'eslint.config.js'] }),
            expect.any(Object),
        );
    });

    it('carries the variant\'s --config argument into a typescript-show-config probe', async () => {
        await runCompatibilityProbe({ kind: 'typescript-show-config' }, {
            ...evidence, variantArgs: ['--config', 'tsconfig.awm.json', '--noEmit'],
        }, fakeExecutor);

        expect(fakeExecutor).toHaveBeenCalledWith(
            expect.objectContaining({ args: ['--config', 'tsconfig.awm.json', '--showConfig'] }),
            expect.any(Object),
        );
    });

    it('carries the variant\'s --config argument into a semgrep-validate probe', async () => {
        await runCompatibilityProbe({ kind: 'semgrep-validate' }, {
            ...evidence, variantArgs: ['--config', '.semgrep.awm.yml', '--json', '.'],
        }, fakeExecutor);

        expect(fakeExecutor).toHaveBeenCalledWith(
            expect.objectContaining({ args: ['--config', '.semgrep.awm.yml', '--validate'] }),
            expect.any(Object),
        );
    });

    it('omits --config from the probe when the variant command declares none', async () => {
        await runCompatibilityProbe({ kind: 'eslint-print-config' }, { ...evidence, variantArgs: ['.', '--cache'] }, fakeExecutor);

        expect(fakeExecutor).toHaveBeenCalledWith(
            expect.objectContaining({ args: ['--print-config', 'eslint.config.js'] }),
            expect.any(Object),
        );
    });
});
