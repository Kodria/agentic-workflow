import fs from 'fs';
import path from 'path';

type Acceptance = {
    schemaVersion: number;
    cli: { version: string };
    registry: { tag: string; commit: string };
    platforms: Record<string, { status: string; evidence: string }>;
    matrix: { report: string; commandCount: number };
};

const acceptancePath = path.resolve(__dirname, '../../../docs/research/sensor-gate-honesty/published-acceptance.json');

describe('published sensor gate acceptance artifact', () => {
    it('contains only complete, portable publication identities and evidence references', () => {
        const artifact = JSON.parse(fs.readFileSync(acceptancePath, 'utf8')) as Acceptance;

        expect(artifact.schemaVersion).toBe(1);
        expect(artifact.cli.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(artifact.registry.tag).toMatch(/^v\d+\.\d+\.\d+$/);
        expect(artifact.registry.commit).toMatch(/^[0-9a-f]{40}$/);
        expect(artifact.matrix.report).toBe('published-sensor-gate-matrix.json');
        expect(artifact.matrix.commandCount).toBeGreaterThan(0);
        expect(Object.keys(artifact.platforms).sort()).toEqual(['linux', 'macos', 'windows']);
        for (const platform of Object.values(artifact.platforms)) {
            expect(platform.status).toBe('pass');
            expect(platform.evidence).toMatch(/^https:\/\//);
        }
        expect(fs.readFileSync(acceptancePath, 'utf8').endsWith('\n')).toBe(true);
    });
});
