import fs from 'fs';
import os from 'os';
import path from 'path';
import { planV2Migration, replaceV2ManifestWithV3 } from '../../../src/commands/sensors/migrate';

const sensor = {
    enabled: false, fast: true, timeout: 45_000, variantId: 'eslint-9',
    command: { executable: 'eslint', resolution: 'node-modules-bin' as const, args: ['.', '--format', 'json'] },
    assets: ['eslint.config.awm.mjs'], policyRef: 'shared/semgrep-policy.json' as const,
    initializedCompatibility: { state: 'certified' as const, reason: 'range-and-probe', variantId: 'eslint-9', toolVersion: '9.0.0', runtimeVersion: '24.0.0', certifiedRange: '>=9 <10', evidence: [{ kind: 'version', status: 'pass' }] },
};
const v2 = { schemaVersion: 2, pack: 'js-ts', packSelection: 'explicit' as const, registryRoot: '/home/alice/.awm/registries/baseline', packageRoot: 'cli', sensors: { lint: sensor }, concurrency: 2 };

describe('planV2Migration', () => {
    it('returns an equivalent portable v3 candidate bound to the exact logical source', () => {
        const plan = planV2Migration({ manifest: v2, source: { kind: 'logical', registry: 'baseline' } });
        expect(plan.equivalent).toBe(true);
        expect(plan.equivalence).toEqual({
            pack: true,
            enabledDisabled: true,
            structuredCommands: true,
            assets: true,
            timeouts: true,
            concurrency: true,
            compatibilityEvidence: true,
            packageRoot: true,
            logicalSourceBinding: true,
        });
        expect(plan.candidate).toEqual({ schemaVersion: 3, mode: 'project-sensors', pack: 'js-ts', packSelection: 'explicit', source: { registry: 'baseline' }, packageRoot: 'cli', sensors: { lint: sensor }, concurrency: 2 });
        expect(JSON.stringify(plan.candidate)).not.toContain('registryRoot');
        expect(JSON.stringify(plan.candidate)).not.toContain('/home/alice');
        expect(JSON.stringify(plan.equivalence)).not.toContain('registryRoot');
        expect(JSON.stringify(plan.equivalence)).not.toContain('/home/alice');
    });

    test.each([
        [{ manifest: { schemaVersion: 3, mode: 'native-gate', reason: 'CI' }, source: { kind: 'logical', registry: 'baseline' } }, 'v2'],
        [{ manifest: v2, source: { kind: 'source-unavailable' } }, 'unavailable'],
        [{ manifest: v2, source: { kind: 'source-ambiguous' } }, 'ambiguous'],
        [{ manifest: v2, source: { kind: 'logical', registry: 'Baseline' } }, 'registry'],
        [{ manifest: v2, source: { kind: 'logical', registry: 'baseline', pack: 'python' } }, 'mismatch'],
        [{ manifest: { pack: 'js-ts', sensors: { lint: 'npm run lint' } }, source: { kind: 'logical', registry: 'baseline' } }, 'v2'],
    ])('rejects unsafe migration input %#', (input, message) => {
        expect(() => planV2Migration(input)).toThrow(message);
    });

    it('validates before atomic replacement and leaves the v2 original intact on write failure', () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-migrate-'));
        const manifestPath = path.join(project, 'sensors.json');
        const original = JSON.stringify(v2, null, 2) + '\n';
        try {
            fs.writeFileSync(manifestPath, original);
            const plan = planV2Migration({ manifest: v2, source: { kind: 'logical', registry: 'baseline' } });
            fs.chmodSync(project, 0o500);
            expect(() => replaceV2ManifestWithV3(manifestPath, plan.candidate)).toThrow();
            expect(fs.readFileSync(manifestPath, 'utf8')).toBe(original);
        } finally {
            fs.chmodSync(project, 0o700);
            fs.rmSync(project, { recursive: true, force: true });
        }
    });
});
