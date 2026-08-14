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
            fs.mkdirSync(path.join(root, 'node_modules', 'eslint'), { recursive: true });
            fs.writeFileSync(path.join(root, 'node_modules', 'eslint', 'package.json'), JSON.stringify({ name: 'eslint', version: '10.4.1' }));
            const evidence = discoverProjectEvidence(root, { schemaVersion: 2, name: 'js-ts', detects: ['package.json'], sensors: { lint: { applicability: { allFiles: ['package.json'] }, variants: [{ requirements: { tool: 'eslint', configFiles: [] } }] } } } as any, { platform: () => 'darwin' });
            expect(evidence.packageManagerConflict).toBe(true);
            expect(evidence.os).toBe('darwin');
            expect(evidence.declaredToolRanges.eslint).toBe('10.0.0');
            expect(evidence.toolVersions.eslint).toBe('10.4.1');
            expect(evidence.scripts).toContain('lint');
            expect(evidence.configFiles).toContain('eslint.config.js');
            expect(evidence.paths.every((item: string) => !path.isAbsolute(item) && !item.includes('..'))).toBe(true);
        } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
});
