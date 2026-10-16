import fs from 'fs';
import path from 'path';

/** CMD-DOCS — V-R4 (issue #215 documentation). */
const repoRoot = path.resolve(__dirname, '../../..');
const read = (relative: string): string => fs.readFileSync(path.join(repoRoot, ...relative.split('/')), 'utf8');

describe('issue #215 documentation contract (V-R4)', () => {
    it('documents .awm/admission.json with defaults, the git rule and the accepted risk', () => {
        const doc = read('docs/configuration.md');
        expect(doc).toContain('## Read-only admission observation (`.awm/admission.json`)');
        for (const name of ['node_modules', '.next', '.turbo', 'dist', 'build', 'coverage', '.venv', 'target']) expect(doc).toContain(`\`${name}\``);
        expect(doc).toContain('git-ignored and contains no tracked file');
        expect(doc).toContain('**Accepted risk:**');
        expect(doc).toContain('`admission-config-invalid`');
        expect(doc).toContain('`readOnlyObservation`');
    });

    it('points --verify-sensors in the CLI reference at the observation rules', () => {
        const doc = read('docs/cli-reference.md');
        expect(doc).toContain('configuration.md#read-only-admission-observation-awmadmissionjson');
        expect(doc).toContain('`readOnlyObservation`');
    });

    it('states that the D-7 insteadOf recipe passes strict currentness', () => {
        const doc = read('docs/operations/cloud-and-platforms.md');
        expect(doc).toContain('`awm preflight --require-current`');
        expect(doc).toContain('`remote.origin.url`');
    });

    it('describes the snapshot exclusions in the plan admit help', () => {
        expect(read('cli/src/commands/plan/index.ts')).toContain(
            "'require an empirical sensor pass; read-only observation skips git-ignored build output (see .awm/admission.json)'",
        );
    });
});
