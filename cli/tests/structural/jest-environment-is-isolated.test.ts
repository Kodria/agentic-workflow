import os from 'os';

describe('Jest environment isolation', () => {
    it('does not inherit the operator Codex home', () => {
        expect(process.env.CODEX_HOME).toBeUndefined();
    });

    it('uses a suite-owned temporary directory', () => {
        expect(os.tmpdir()).toContain('awm-jest-');
    });
});
