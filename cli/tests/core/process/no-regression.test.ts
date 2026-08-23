// cli/tests/core/process/no-regression.test.ts
import { collectDashboardSnapshot } from '../../../src/core/dashboard/collect';
import { discoverProcessModels } from '../../../src/core/process/discover';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('R7 — ausencia de modelos y aislamiento', () => {
    let root: string;
    let home: string;
    const realHome = process.env.HOME;
    const realAwmHome = process.env.AWM_HOME;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-process-noreg-'));
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-process-home-'));
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        // R7.4: ningún test toca el ~/.awm real.
        process.env.HOME = home;
        process.env.AWM_HOME = path.join(home, '.awm');
    });
    afterEach(() => {
        process.env.HOME = realHome; process.env.AWM_HOME = realAwmHome;
        fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
    });

    it('sin modelos, el snapshot conserva las nueve secciones en orden', () => {  // verifies R7.2
        const snapshot = collectDashboardSnapshot({ cwd: root, now: '2026-08-23T00:00:00.000Z' });
        expect(snapshot.sections.map((s) => s.id)).toEqual(
            ['machine', 'project', 'planning', 'execution', 'qa', 'docs', 'retro', 'history', 'processes']);
        expect(snapshot.schema).toBe(2);
        expect(snapshot.sections.find((s) => s.id === 'processes')).toEqual(
            expect.objectContaining({ availability: 'not_applicable', items: [] }));
    });

    it('el descubridor no toca el ~/.awm real', () => {                          // verifies R7.4
        expect(() => discoverProcessModels()).not.toThrow();
        expect(fs.existsSync(path.join(String(realHome), '.awm', 'process-cache'))).toBe(false);
    });

    it('usa path.join y no separadores hardcodeados', () => {                    // verifies R7.3
        const src = fs.readFileSync(path.resolve(__dirname, '../../../src/core/process/discover.ts'), 'utf-8');
        expect(src).not.toMatch(/['"`][^'"`]*\/skills\//);
        expect(src).toContain('path.join');
    });
});
