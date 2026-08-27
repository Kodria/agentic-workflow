import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseSensorManifest } from '../../../../src/commands/sensors/compatibility/manifest';

const sourceModule = '../../../../src/commands/sensors/compatibility/source';

function manifest(registryRoot?: string) {
    return parseSensorManifest({
        schemaVersion: 2, pack: 'js-ts', ...(registryRoot ? { registryRoot } : {}), sensors: {
            lint: {
                enabled: false, variantId: 'eslint-9',
                command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
                initializedCompatibility: { state: 'certified', reason: 'fixture', variantId: 'eslint-9', toolVersion: '9.0.0', runtimeVersion: '24.0.0', certifiedRange: '>=9 <10', evidence: [] },
            },
        },
    }, 'manifest');
}

function pack() {
    return {
        schemaVersion: 2, name: 'js-ts', description: 'fixture', detects: ['package.json'], sensors: {
            lint: { applicability: { allFiles: ['package.json'] }, variants: [{
                id: 'eslint-9', priority: 1,
                requirements: { tool: 'eslint', toolRange: '>=9 <10', runtime: 'node', runtimeRange: '>=20' },
                certifiedRange: '>=9 <10', assets: [], formatter: 'generic', probe: { kind: 'eslint-print-config' },
                command: { executable: 'eslint', resolution: 'node-modules-bin', args: ['.'] },
            }] },
        },
        coverage: { schemaVersion: 1, classes: { linting: { description: 'fixture', detectors: [{ sensor: 'lint' }], remedy: { summary: 'fixture', command: 'npm test' } } } },
    };
}

function writePack(root: string): void {
    const directory = path.join(root, 'sensor-packs', 'js-ts');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'pack.json'), JSON.stringify(pack()));
}

describe('resolveSensorSource', () => {
    const roots: string[] = [];
    afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

    function resolve(input: ReturnType<typeof manifest>, registries: unknown): any {
        return require(sourceModule).resolveSensorSource(input, { registries });
    }

    it('preserves an existing v2 provenance path without registry-order rebinding', () => {
        const bound = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-source-bound-')); roots.push(bound);
        const other = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-source-other-')); roots.push(other);
        writePack(bound); writePack(other);
        expect(resolve(manifest(bound), [
            { name: 'other', remote: 'https://user:secret@example.invalid/other', contentRoot: other },
        ])).toMatchObject({ kind: 'legacy-bound', source: { registry: { name: 'manifest-provenance' } } });
    });

    it('rebinds an absent v2 provenance only when exactly one registry matches every sensor identity', () => {
        const homeA = path.join(os.tmpdir(), 'does-not-exist-awma');
        const homeB = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-source-home-b-')); roots.push(homeB);
        writePack(homeB);
        expect(resolve(manifest(homeA), [{ name: 'baseline', remote: 'https://example.invalid/baseline.git', contentRoot: homeB }]))
            .toMatchObject({ kind: 'legacy-rebound', source: { registry: { name: 'baseline' } } });
    });

    it('fails closed for zero or multiple structural candidates without exposing paths or remotes', () => {
        const absent = path.join(os.tmpdir(), 'does-not-exist-awmb');
        expect(resolve(manifest(absent), [])).toMatchObject({ kind: 'source-unavailable', reason: 'no-compatible-registry' });
        const first = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-source-first-')); roots.push(first);
        const second = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-source-second-')); roots.push(second);
        writePack(first); writePack(second);
        const result = resolve(manifest(absent), [
            { name: 'first', remote: 'https://user:secret@example.invalid/first', contentRoot: first },
            { name: 'second', remote: 'https://user:secret@example.invalid/second', contentRoot: second },
        ]);
        expect(result).toMatchObject({ kind: 'source-ambiguous', candidates: ['first', 'second'] });
        expect(JSON.stringify(result)).not.toContain('secret');
    });
});
