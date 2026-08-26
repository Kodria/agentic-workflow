import fs from 'fs';
import path from 'path';

const cliReference = fs.readFileSync(path.resolve(__dirname, '../../../docs/cli-reference.md'), 'utf8');
const readme = fs.readFileSync(path.resolve(__dirname, '../../../README.md'), 'utf8');
const installation = fs.readFileSync(path.resolve(__dirname, '../../../docs/installation.md'), 'utf8');
const developmentProcess = fs.readFileSync(path.resolve(__dirname, '../../../docs/guides/development-process.md'), 'utf8');

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

    it('keeps supported commands, remedies, bootstrap, and the enforceable boundary discoverable across user docs', () => {
        expect(readme).toContain('awm plan validate PLAN_PATH');
        expect(readme).toContain('awm preflight --require-current');
        expect(installation).toContain('npm exec --yes --package=agentic-workflow-manager@latest -- awm preflight --require-current');
        expect(installation).toMatch(/cannot update a host or cached container that\s+never runs new code/i);
        expect(developmentProcess).toContain('awm preflight --require-current');
        expect(developmentProcess).toContain('awm plan validate PLAN_PATH');
        expect(developmentProcess).toMatch(/awm update --yes/);
        expect(cliReference).toMatch(/awm unpin REGISTRY_NAME.*awm update --yes/s);
    });
});
