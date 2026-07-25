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
