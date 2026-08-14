import fs from 'fs';
import path from 'path';

const entrypoint = path.resolve(__dirname, '../../src/index.ts');

describe('CLI async entrypoint contract', () => {
    it('awaits Commander actions instead of starting them with parse()', () => {
        const source = fs.readFileSync(entrypoint, 'utf8');

        expect(source).toMatch(/program\.parseAsync\(\)\.catch\(/);
        expect(source).not.toMatch(/\bprogram\.parse\(\);/);
    });
});
