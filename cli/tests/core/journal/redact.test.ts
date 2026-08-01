import { redactText, redactArgv, findLiteralSecretFlag } from '../../../src/core/journal/redact';

describe('redact', () => {
    test('redactText enmascara asignaciones sospechosas (R2.3)', () => {   // verifies R2.3
        expect(redactText('export API_KEY=abc123secreto')).toContain('[REDACTED]');
        expect(redactText('password: hunter2')).toContain('[REDACTED]');
        expect(redactText('linea inocente')).toBe('linea inocente');
    });

    test('findLiteralSecretFlag detecta flags sensibles con valor literal (R2.3)', () => {  // verifies R2.3
        expect(findLiteralSecretFlag(['cmd', '--token', 'abc123'])).toBe('--token');
        expect(findLiteralSecretFlag(['cmd', '--api-key=xyz'])).toBe('--api-key');
        expect(findLiteralSecretFlag(['cmd', '--token-env', 'MY_TOKEN'])).toBeNull();
        expect(findLiteralSecretFlag(['npm', 'test'])).toBeNull();
    });

    test('findLiteralSecretFlag detecta un valor literal que empieza con -- (R2.3)', () => {  // verifies R2.3
        expect(findLiteralSecretFlag(['cmd', '--token', '--abc123secretvalue'])).toBe('--token');
    });

    test('findLiteralSecretFlag rechaza sin importar si el siguiente token parece otro flag (R2.3)', () => {  // verifies R2.3
        expect(findLiteralSecretFlag(['cmd', '--token', '--password', 'hunter2'])).toBe('--token');
        expect(findLiteralSecretFlag(['cmd', '--token', '--my-secret-data'])).toBe('--token');
    });

    test('redactArgv nunca deja el valor de un flag sensible (R2.3)', () => {  // verifies R2.3
        expect(redactArgv(['x', '--password', 'hunter2'])).toEqual(['x', '--password', '[REDACTED]']);
    });

    test('redactArgv redacta un valor literal que empieza con -- (R2.3)', () => {  // verifies R2.3
        expect(redactArgv(['cmd', '--token', '--abc123secretvalue'])).toEqual(['cmd', '--token', '[REDACTED]']);
    });

    test('redactArgv redacta TODA la cadena ambigua cuando el valor parece otro flag sensible, sin dejar pasar el secreto real (R2.3)', () => {  // verifies R2.3
        expect(redactArgv(['cmd', '--token', '--password', 'hunter2'])).toEqual(['cmd', '--token', '[REDACTED]', '[REDACTED]']);
        expect(redactArgv(['cmd', '--token', '--my-secret-data'])).toEqual(['cmd', '--token', '[REDACTED]']);
        expect(redactArgv(['cmd', '--api-key', '--secret'])).toEqual(['cmd', '--api-key', '[REDACTED]']);
    });
});
