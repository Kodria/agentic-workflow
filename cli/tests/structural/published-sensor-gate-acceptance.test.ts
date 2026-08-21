import fs from 'fs';
import path from 'path';

type Acceptance = {
    schemaVersion: number;
    issues: number[];
    verdict: string;
    cli: { version: string; packageHash: string };
    registry: { tag: string; commit: string; packHash: string };
    platforms: Record<string, { status: string; evidence: string }>;
    matrix: { report: string; commandCount: number };
};

const acceptancePath = path.resolve(__dirname, '../../../docs/research/sensor-gate-honesty/published-acceptance.json');
const reportPath = path.resolve(__dirname, '../../../docs/research/sensor-gate-honesty/published-sensor-gate-matrix.json');

describe('published sensor gate acceptance artifact', () => {
    it('contains only complete, portable publication identities and evidence references', () => {
        const artifact = JSON.parse(fs.readFileSync(acceptancePath, 'utf8')) as Acceptance;
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as { cli: { version: string }; registry: { tag: string; commit: string }; commands: unknown[] };

        expect(artifact.schemaVersion).toBe(1);
        expect(artifact.issues).toEqual([95, 96, 97, 98]);
        expect(artifact.verdict).toBe('partial');
        expect(artifact.cli.version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(artifact.cli.packageHash).toMatch(/^[0-9a-f]{64}$/);
        expect(artifact.registry.tag).toMatch(/^v\d+\.\d+\.\d+$/);
        expect(artifact.registry.commit).toMatch(/^[0-9a-f]{40}$/);
        expect(artifact.registry.packHash).toMatch(/^[0-9a-f]{64}$/);
        expect(artifact.matrix.report).toBe('published-sensor-gate-matrix.json');
        expect(artifact.matrix.commandCount).toBe(12);
        expect(report.commands).toHaveLength(artifact.matrix.commandCount);
        expect(report.cli.version).toBe(artifact.cli.version);
        expect(report.registry).toMatchObject(artifact.registry);
        expect(JSON.stringify(report)).not.toMatch(/\/(tmp|srv)\//);
        expect(Object.keys(artifact.platforms).sort()).toEqual(['linux', 'macos', 'windows']);
        for (const platform of Object.values(artifact.platforms)) {
            expect(platform.status).toBe('pass');
            expect(platform.evidence).toMatch(/^https:\/\//);
        }
        expect(fs.readFileSync(acceptancePath, 'utf8').endsWith('\n')).toBe(true);
    });
});
