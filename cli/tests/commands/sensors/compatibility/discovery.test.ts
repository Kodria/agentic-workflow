import fs from 'fs';
import os from 'os';
import path from 'path';
import { discoverProjectEvidence } from '../../../../src/commands/sensors/compatibility/discovery';

describe('discoverProjectEvidence', () => {
    it('returns only local, relative project evidence and detects conflicting lockfiles', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-discovery-'));
        try {
            fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { lint: 'eslint .' }, devDependencies: { eslint: '10.0.0' } }));
            fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
            fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
            fs.writeFileSync(path.join(root, 'eslint.config.js'), 'export default []');
            const evidence = discoverProjectEvidence(root, { name: 'js-ts', detects: ['package.json'], sensors: {} } as any);
            expect(evidence.packageManagerConflict).toBe(true);
            expect(evidence.scripts).toContain('lint');
            expect(evidence.configFiles).toContain('eslint.config.js');
            expect(evidence.paths.every((item: string) => !path.isAbsolute(item) && !item.includes('..'))).toBe(true);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
});
