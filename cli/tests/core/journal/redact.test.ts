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

    test('redactArgv nunca deja el valor de un flag sensible (R2.3)', () => {  // verifies R2.3
        expect(redactArgv(['x', '--password', 'hunter2'])).toEqual(['x', '--password', '[REDACTED]']);
    });

    test('redactArgv redacta un valor literal que empieza con -- (R2.3)', () => {  // verifies R2.3
        expect(redactArgv(['cmd', '--token', '--abc123secretvalue'])).toEqual(['cmd', '--token', '[REDACTED]']);
    });

    test('findLiteralSecretFlag no confunde un flag sensible vecino con el valor del anterior (R2.3)', () => {  // verifies R2.3
        expect(findLiteralSecretFlag(['cmd', '--token', '--password', 'hunter2'])).toBe('--password');
    });

    test('redactArgv no traga un flag sensible vecino como valor del anterior, y sigue redactando el vecino (R2.3)', () => {  // verifies R2.3
        expect(redactArgv(['cmd', '--token', '--password', 'hunter2'])).toEqual(['cmd', '--token', '--password', '[REDACTED]']);
    });
});
