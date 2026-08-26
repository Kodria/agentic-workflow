import fs from 'fs';
import path from 'path';

const cliReference = fs.readFileSync(path.resolve(__dirname, '../../../docs/cli-reference.md'), 'utf8');

describe('R4 plan/currentness documentation contract', () => {
    it('documents plan validation and the unchanged legacy path', () => {
        expect(cliReference).toContain('awm plan validate PLAN_PATH');
        expect(cliReference).toMatch(/legacy/i);
    });

    it('documents strict currentness separately from minCliVersion compatibility', () => {
        expect(cliReference).toContain('--require-current');
        expect(cliReference).toContain('minCliVersion');
        expect(cliReference).toMatch(/currentness[\s\S]{0,700}compatib|compatib[\s\S]{0,700}currentness/i);
    });

    it('documents the exact cache-resistant bootstrap and its enforceable boundary', () => {
        expect(cliReference).toContain('npm exec --yes --package=agentic-workflow-manager@latest -- awm preflight --require-current');
        expect(cliReference).toMatch(/fresh CLI\/bootstrap/i);
        expect(cliReference).toMatch(/cannot update a host or cached container that\s+never runs new code/i);
    });
});
