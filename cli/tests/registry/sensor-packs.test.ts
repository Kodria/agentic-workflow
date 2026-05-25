import fs from 'fs';
import path from 'path';

const REGISTRY_ROOT = path.join(__dirname, '..', '..', '..', 'registry');
const PACKS_DIR = path.join(REGISTRY_ROOT, 'sensor-packs');

describe('sensor-packs registry', () => {
    it('sensor-packs directory exists in registry', () => {
        expect(fs.existsSync(PACKS_DIR)).toBe(true);
    });

    for (const packName of ['js-ts', 'generic']) {
        describe(`pack: ${packName}`, () => {
            const packDir = path.join(PACKS_DIR, packName);

            it('directory exists', () => {
                expect(fs.existsSync(packDir)).toBe(true);
            });

            it('has valid pack.json', () => {
                const packJson = path.join(packDir, 'pack.json');
                expect(fs.existsSync(packJson)).toBe(true);
                const parsed = JSON.parse(fs.readFileSync(packJson, 'utf-8'));
                expect(parsed.name).toBe(packName);
                expect(typeof parsed.description).toBe('string');
                expect(typeof parsed.sensors).toBe('object');
            });

            it('pack.json name matches directory name', () => {
                const parsed = JSON.parse(fs.readFileSync(path.join(packDir, 'pack.json'), 'utf-8'));
                expect(parsed.name).toBe(packName);
            });
        });
    }

    it('js-ts pack has required sensor config files', () => {
        const jstsDir = path.join(PACKS_DIR, 'js-ts');
        expect(fs.existsSync(path.join(jstsDir, 'tsconfig.awm.json'))).toBe(true);
        expect(fs.existsSync(path.join(jstsDir, 'eslint.config.awm.mjs'))).toBe(true);
        expect(fs.existsSync(path.join(jstsDir, '.semgrep.awm.yml'))).toBe(true);
    });

    it('tsconfig.awm.json extends ./tsconfig.json', () => {
        const tsconfig = JSON.parse(fs.readFileSync(path.join(PACKS_DIR, 'js-ts', 'tsconfig.awm.json'), 'utf-8'));
        expect(tsconfig.extends).toBe('./tsconfig.json');
        expect(tsconfig.compilerOptions?.strict).toBe(true);
    });
});
