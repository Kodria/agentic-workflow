import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import {
    ABSENT_MARKER,
    PICOMATCH_DIGEST_OPTIONS,
    buildAlwaysMeasuredPaths,
    computeCacheInputDigest,
} from '../../../src/commands/sensors/inputs-digest';

function git(cwd: string, args: string[]): string {
    return execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function initRepo(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-digest-'));
    git(root, ['init', '-q', '-b', 'main']);
    return root;
}

describe('inputs digest (RF-2.1, RF-2.12, RF-1.6)', () => {
    const roots: string[] = [];
    afterEach(() => {
        for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
    });

    it('documents picomatch options as {dot:true,posix:true} without nocase (RF-1.5/1.6)', () => {
        expect(PICOMATCH_DIGEST_OPTIONS).toEqual({ dot: true, posix: true });
        expect(PICOMATCH_DIGEST_OPTIONS).not.toHaveProperty('nocase');
        expect((PICOMATCH_DIGEST_OPTIONS as { nocase?: boolean }).nocase).toBeUndefined();
    });

    it('enumerates via git ls-files, matches globs with dotfiles, hashes symlink readlink, and marks ABSENT (RF-2.1)', () => {
        const root = initRepo();
        roots.push(root);
        fs.writeFileSync(path.join(root, 'src.ts'), 'a');
        fs.writeFileSync(path.join(root, '.hidden.ts'), 'h');
        fs.writeFileSync(path.join(root, 'ignored.ts'), 'i');
        fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.ts\n');
        fs.symlinkSync('src.ts', path.join(root, 'link.ts'));
        git(root, ['add', '-A']);
        git(root, ['commit', '-qm', 'init']);
        // Deleted but still listed if we force a stale index entry via ls-files after delete without refresh:
        // Prefer: path in globs that is untracked absent — RF says ENOENT on lstat of listed path.
        fs.writeFileSync(path.join(root, 'gone.ts'), 'g');
        git(root, ['add', 'gone.ts']);
        git(root, ['commit', '-qm', 'gone']);
        fs.unlinkSync(path.join(root, 'gone.ts'));

        const digest = computeCacheInputDigest({
            gitRoot: root,
            packageRoot: root,
            inputGlobs: ['**/*.ts'],
            alwaysMeasuredRepoRels: [],
        });
        expect(digest.ok).toBe(true);
        if (!digest.ok) return;
        expect(digest.matchedPaths).toEqual(expect.arrayContaining(['src.ts', '.hidden.ts', 'link.ts', 'gone.ts']));
        expect(digest.matchedPaths).not.toContain('ignored.ts');
        expect(digest.contributions.find((c) => c.path === 'link.ts')).toMatchObject({ kind: 'symlink' });
        expect(digest.contributions.find((c) => c.path === 'gone.ts')).toMatchObject({ kind: 'absent', marker: ABSENT_MARKER });
        expect(digest.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('includes always-measured sensors.json, assets, configFiles, package.json, lockfiles — not baseline.json (RF-2.12)', () => {
        const root = initRepo();
        roots.push(root);
        fs.mkdirSync(path.join(root, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), '{"pack":"js-ts"}');
        fs.writeFileSync(path.join(root, '.awm', 'sensors.baseline.json'), '{"lint":[]}');
        fs.writeFileSync(path.join(root, 'package.json'), '{"name":"x"}');
        fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
        fs.writeFileSync(path.join(root, 'eslint.config.awm.mjs'), 'export default []');
        fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');
        fs.writeFileSync(path.join(root, 'src.ts'), 'x');
        git(root, ['add', '-A']);
        git(root, ['commit', '-qm', 'init']);

        const always = buildAlwaysMeasuredPaths({
            sensorsJsonRel: '.awm/sensors.json',
            assetRels: ['eslint.config.awm.mjs'],
            configFileRels: ['tsconfig.json'],
            includePackageJson: true,
            packageRootRel: '',
        });
        expect(always).toEqual(expect.arrayContaining([
            '.awm/sensors.json',
            'eslint.config.awm.mjs',
            'tsconfig.json',
            'package.json',
            'package-lock.json',
        ]));
        expect(always).not.toContain('.awm/sensors.baseline.json');

        const withBaselinePoison = computeCacheInputDigest({
            gitRoot: root,
            packageRoot: root,
            inputGlobs: ['**/*.ts'],
            alwaysMeasuredRepoRels: always,
        });
        expect(withBaselinePoison.ok).toBe(true);
        if (!withBaselinePoison.ok) return;

        fs.writeFileSync(path.join(root, '.awm', 'sensors.baseline.json'), '{"lint":["changed"]}');
        const afterBaseline = computeCacheInputDigest({
            gitRoot: root,
            packageRoot: root,
            inputGlobs: ['**/*.ts'],
            alwaysMeasuredRepoRels: always,
        });
        expect(afterBaseline.ok).toBe(true);
        if (!afterBaseline.ok) return;
        expect(afterBaseline.digest).toBe(withBaselinePoison.digest);

        fs.writeFileSync(path.join(root, 'package.json'), '{"name":"y"}');
        const afterPkg = computeCacheInputDigest({
            gitRoot: root,
            packageRoot: root,
            inputGlobs: ['**/*.ts'],
            alwaysMeasuredRepoRels: always,
        });
        expect(afterPkg.ok).toBe(true);
        if (!afterPkg.ok) return;
        expect(afterPkg.digest).not.toBe(withBaselinePoison.digest);
    });

    it('hard-excludes .awm/sensors.baseline.json from cache digest even when globs match it (RF-2.12/2.13)', () => {
        const root = initRepo();
        roots.push(root);
        fs.mkdirSync(path.join(root, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), '{"pack":"js-ts"}');
        fs.writeFileSync(path.join(root, '.awm', 'sensors.baseline.json'), '{"lint":["old"]}');
        fs.writeFileSync(path.join(root, 'other.json'), '{"x":1}');
        git(root, ['add', '-A']);
        git(root, ['commit', '-qm', 'init']);

        const before = computeCacheInputDigest({
            gitRoot: root,
            packageRoot: root,
            inputGlobs: ['**/*.json'],
            alwaysMeasuredRepoRels: ['.awm/sensors.json'],
        });
        expect(before.ok).toBe(true);
        if (!before.ok) return;
        expect(before.matchedPaths).not.toContain('.awm/sensors.baseline.json');
        expect(before.matchedPaths).toEqual(expect.arrayContaining(['.awm/sensors.json', 'other.json']));

        fs.writeFileSync(path.join(root, '.awm', 'sensors.baseline.json'), '{"lint":["new-fingerprint"]}');
        const afterBaselineEdit = computeCacheInputDigest({
            gitRoot: root,
            packageRoot: root,
            inputGlobs: ['**/*.json'],
            alwaysMeasuredRepoRels: ['.awm/sensors.json'],
        });
        expect(afterBaselineEdit.ok).toBe(true);
        if (!afterBaselineEdit.ok) return;
        expect(afterBaselineEdit.digest).toBe(before.digest);

        fs.writeFileSync(path.join(root, 'other.json'), '{"x":2}');
        const afterOther = computeCacheInputDigest({
            gitRoot: root,
            packageRoot: root,
            inputGlobs: ['**/*.json'],
            alwaysMeasuredRepoRels: ['.awm/sensors.json'],
        });
        expect(afterOther.ok).toBe(true);
        if (!afterOther.ok) return;
        expect(afterOther.digest).not.toBe(before.digest);
    });

    it('never follows symlinks when hashing file contents (RF-2.1 security)', () => {
        const root = initRepo();
        roots.push(root);
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-digest-out-'));
        roots.push(outside);
        fs.writeFileSync(path.join(outside, 'secret'), 'SECRET');
        fs.symlinkSync(path.join(outside, 'secret'), path.join(root, 'trap.ts'));
        git(root, ['add', '-A']);
        git(root, ['commit', '-qm', 'init']);

        const digest = computeCacheInputDigest({
            gitRoot: root,
            packageRoot: root,
            inputGlobs: ['**/*.ts'],
            alwaysMeasuredRepoRels: [],
        });
        expect(digest.ok).toBe(true);
        if (!digest.ok) return;
        const trap = digest.contributions.find((c) => c.path === 'trap.ts');
        expect(trap?.kind).toBe('symlink');
        expect(JSON.stringify(digest)).not.toContain('SECRET');
    });

    it('fails closed when git cannot list files (RF-E.2)', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-digest-nogit-'));
        roots.push(root);
        const digest = computeCacheInputDigest({
            gitRoot: root,
            packageRoot: root,
            inputGlobs: ['**/*.ts'],
            alwaysMeasuredRepoRels: [],
        });
        expect(digest).toEqual({ ok: false, reason: 'git-failed' });
    });

    it('matches globs relative to packageRoot in a monorepo layout', () => {
        const root = initRepo();
        roots.push(root);
        fs.mkdirSync(path.join(root, 'cli', 'src'), { recursive: true });
        fs.writeFileSync(path.join(root, 'cli', 'src', 'a.ts'), 'a');
        fs.writeFileSync(path.join(root, 'other.ts'), 'o');
        git(root, ['add', '-A']);
        git(root, ['commit', '-qm', 'init']);

        const digest = computeCacheInputDigest({
            gitRoot: root,
            packageRoot: path.join(root, 'cli'),
            inputGlobs: ['src/**/*.ts'],
            alwaysMeasuredRepoRels: [],
        });
        expect(digest.ok).toBe(true);
        if (!digest.ok) return;
        expect(digest.matchedPaths).toContain('cli/src/a.ts');
        expect(digest.matchedPaths).not.toContain('other.ts');
    });
});
