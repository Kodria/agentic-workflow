import { assertProviderSupported } from '../../src/core/provider-version';

describe('assertProviderSupported', () => {
    it('accepts the current stable Codex line', () => {
        const exec = jest.fn(() => Buffer.from('codex-cli 0.145.0\n'));
        expect(assertProviderSupported('codex', exec)).toEqual({
            provider: 'codex',
            version: '0.145.0',
        });
        expect(exec).toHaveBeenCalledWith('codex', ['--version'], expect.any(Object));
    });

    // Regression: npm installs `codex` as `codex.cmd` on Windows, and
    // execFileSync can't CreateProcess a `.cmd` shim without a shell — it threw
    // ENOENT here even on a machine where `codex --version` worked fine typed
    // directly. `provider.versionCommand` is hardcoded first-party config
    // (providers/index.ts), never attacker-controlled, so `shell: true` here
    // carries none of the injection risk core/paths.ts's resolveOnPath was
    // built to avoid for sensors.json's user/registry-supplied `cmd`.
    describe('on native Windows', () => {
        const realPlatform = process.platform;
        afterEach(() => {
            Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
        });

        it('runs the version probe through a shell so the .cmd shim resolves', () => {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            const exec = jest.fn(() => Buffer.from('codex-cli 0.145.0\n'));
            assertProviderSupported('codex', exec);
            expect(exec).toHaveBeenCalledWith('codex', ['--version'], expect.objectContaining({ shell: true }));
        });

        it('does not use a shell on non-Windows platforms', () => {
            Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
            const exec = jest.fn(() => Buffer.from('codex-cli 0.145.0\n'));
            assertProviderSupported('codex', exec);
            expect(exec).toHaveBeenCalledWith('codex', ['--version'], expect.objectContaining({ shell: false }));
        });

        // Regression from the fix above: shipping shell:true changed how a
        // GENUINELY missing binary fails. Without a shell it's a spawn-level
        // ENOENT; through cmd.exe the shell itself starts fine and the missing
        // command surfaces as a non-zero exit with this exact stderr text — no
        // ENOENT anywhere. windows-latest CI (no codex installed) caught this:
        // it started reporting "version probe failed" instead of "not
        // installed" the first time shell:true shipped without this branch.
        it('still reports "not installed" when the shell itself says the command is unknown', () => {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            const shellNotFound = Object.assign(new Error('Command failed: codex --version'), {
                status: 1,
                stderr: Buffer.from("'codex' is not recognized as an internal or external command,\r\noperable program or batch file.\r\n"),
            });
            expect(() => assertProviderSupported('codex', () => { throw shellNotFound; }))
                .toThrow('Codex is not installed or not available on PATH');
        });
    });

    it.each(['0.145.1', '0.146.0', '1.0.0'])(
        'accepts stable Codex version %s above the minimum',
        (version) => {
            expect(assertProviderSupported(
                'codex',
                () => Buffer.from(`codex-cli ${version}\n`),
            )).toEqual({ provider: 'codex', version });
        },
    );

    it.each([
        [Buffer.from('codex-cli 0.144.9\n'), 'requires Codex >= 0.145.0'],
        [Buffer.from('unknown\n'), 'could not parse Codex version'],
        [Buffer.from('codex-cli 0.145.0-beta.1\n'), 'could not parse Codex version'],
        [Buffer.from('codex-cli v0.145.0\n'), 'could not parse Codex version'],
        [Buffer.from('codex-cli 0.145\n'), 'could not parse Codex version'],
        [Buffer.from('unexpected-tool 9.9.9\n'), 'could not parse Codex version'],
        [Buffer.from('notice: codex-cli 0.145.0\n'), 'could not parse Codex version'],
        [Buffer.from('codex-cli stable 0.145.0\n'), 'could not parse Codex version'],
        [Buffer.from('codex-cli 0.145.0 trailing\n'), 'could not parse Codex version'],
    ])('rejects unsupported output without mutation', (output, message) => {
        expect(() => assertProviderSupported('codex', () => output)).toThrow(message);
    });

    it('returns a null version for providers without a version gate', () => {
        const exec = jest.fn();
        expect(assertProviderSupported('claude-code', exec)).toEqual({
            provider: 'claude-code',
            version: null,
        });
        expect(exec).not.toHaveBeenCalled();
    });

    it('reports a missing Codex binary distinctly', () => {
        const missing = Object.assign(new Error('spawnSync codex ENOENT'), { code: 'ENOENT' });
        expect(() => assertProviderSupported('codex', () => { throw missing; }))
            .toThrow('Codex is not installed or not available on PATH');
    });

    it('reports other Codex probe failures distinctly', () => {
        expect(() => assertProviderSupported('codex', () => {
            throw new Error('permission denied');
        })).toThrow('Codex version probe failed: permission denied');
    });

    it('fails loudly for invalid runtime provider input', () => {
        const exec = jest.fn();
        expect(() => assertProviderSupported('invalid' as any, exec))
            .toThrow('Unknown agent target');
        expect(exec).not.toHaveBeenCalled();
    });
});
