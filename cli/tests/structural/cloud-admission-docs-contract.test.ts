import fs from 'fs';
import path from 'path';

/** CMD-DOCS — V-R4 (issue #215 documentation). */
const repoRoot = path.resolve(__dirname, '../../..');
/** Whitespace-normalized so re-wrapping the prose never breaks a pinned phrase. */
const read = (relative: string): string =>
    fs.readFileSync(path.join(repoRoot, ...relative.split('/')), 'utf8').replace(/\s+/g, ' ');

describe('issue #215 documentation contract (V-R4)', () => {
    const configuration = read('docs/configuration.md');

    it('documents .awm/admission.json with defaults, the git rule and the accepted risk', () => {
        expect(configuration).toContain('## Read-only admission observation (`.awm/admission.json`)');
        for (const name of ['node_modules', '.next', '.turbo', 'dist', 'build', 'coverage', '.venv', 'target']) expect(configuration).toContain(`\`${name}\``);
        expect(configuration).toContain('git-ignored and contains no tracked file');
        expect(configuration).toContain('**Accepted risk:**');
        expect(configuration).toContain('`admission-config-invalid`');
        expect(configuration).toContain('`readOnlyObservation`');
    });

    it.each([
        '250000',
        '1 GiB',
        '`read-only-mutation-detected`',
        '`read-only-observation-unavailable`',
        '`not-ignored`',
        '`contains-tracked`',
        '`git-unavailable`',
        '`.git` or `.awm`',
        'never skipped',
        'including any `.awm` or `.git` nested',
        'regular file',
        '65536 bytes',
    ])('documents the observation limit, reason code or reserved-name rule %s', literal => {
        expect(configuration).toContain(literal);
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
        expect(doc).toContain('--local');
    });

    it('describes the snapshot exclusions in the plan admit help', () => {
        expect(read('cli/src/commands/plan/index.ts')).toContain(
            "'require an empirical sensor pass; read-only observation skips git-ignored build output (see .awm/admission.json)'",
        );
    });
});
