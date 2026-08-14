import fs from 'fs';
import os from 'os';
import path from 'path';
import { materializeResolvedSensors } from '../../../../src/commands/sensors/compatibility/materialize';

const evidence = { state: 'certified' as const, reason: 'range-and-probe', variantId: 'eslint-10', toolVersion: '10.0.0', runtimeVersion: '22.0.0', certifiedRange: '>=10 <11', evidence: [] };

describe('materializeResolvedSensors', () => {
    let projectRoot: string;
    let packRoot: string;
    beforeEach(() => {
        projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-materialize-project-'));
        packRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-materialize-pack-'));
        fs.writeFileSync(path.join(packRoot, 'eslint.config.awm.mjs'), 'export default [];');
        fs.writeFileSync(path.join(packRoot, 'tsconfig.awm.json'), '{}');
    });
    afterEach(() => {
        fs.rmSync(projectRoot, { recursive: true, force: true });
        fs.rmSync(packRoot, { recursive: true, force: true });
    });

    it('copies only selected assets and writes a v2 manifest atomically', () => {
        const result = materializeResolvedSensors({ projectRoot, packRoot, pack: 'js-ts', sensors: {
            lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
        } });
        expect(result.configured).toEqual(['eslint.config.awm.mjs']);
        expect(fs.existsSync(path.join(projectRoot, 'tsconfig.awm.json'))).toBe(false);
        expect(JSON.parse(fs.readFileSync(path.join(projectRoot, '.awm', 'sensors.json'), 'utf8'))).toMatchObject({ schemaVersion: 2, sensors: { lint: { variantId: 'eslint-10' } } });
        expect(fs.readdirSync(path.join(projectRoot, '.awm'))).not.toContain('sensors.json.tmp');
    });

    it('preserves a destination that already exists', () => {
        fs.writeFileSync(path.join(projectRoot, 'eslint.config.awm.mjs'), 'owner content');
        const result = materializeResolvedSensors({ projectRoot, packRoot, pack: 'js-ts', sensors: {
            lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
        } });
        expect(result.preserved).toEqual(['eslint.config.awm.mjs']);
        expect(fs.readFileSync(path.join(projectRoot, 'eslint.config.awm.mjs'), 'utf8')).toBe('owner content');
    });

    it('reports previous AWM assets as orphaned and never deletes them', () => {
        fs.mkdirSync(path.join(projectRoot, '.awm'));
        fs.writeFileSync(path.join(projectRoot, '.awm', 'sensors.json'), JSON.stringify({ schemaVersion: 2, pack: 'js-ts', sensors: {
            lint: { enabled: true, variantId: 'old', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.cjs'], initializedCompatibility: { ...evidence, variantId: 'old' } },
        } }));
        fs.writeFileSync(path.join(projectRoot, 'eslint.config.awm.cjs'), 'old');
        const result = materializeResolvedSensors({ projectRoot, packRoot, pack: 'js-ts', sensors: {
            lint: { enabled: true, variantId: 'eslint-10', command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] }, assets: ['eslint.config.awm.mjs'], initializedCompatibility: evidence },
        } });
        expect(result.orphaned).toEqual(['eslint.config.awm.cjs']);
        expect(fs.existsSync(path.join(projectRoot, 'eslint.config.awm.cjs'))).toBe(true);
    });
});
