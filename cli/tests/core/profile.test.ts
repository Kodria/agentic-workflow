import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    findProjectRoot,
    readProfile,
    writeProfile,
    addExtension,
    ensureSkillsGitignored,
    shouldRecordExtension,
} from '../../src/core/profile';

function tmpRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'awm-profile-'));
}

describe('findProjectRoot', () => {
    it('finds the root via a .git marker walking up from a subdir', () => {
        const root = tmpRoot();
        fs.mkdirSync(path.join(root, '.git'));
        const sub = path.join(root, 'a', 'b');
        fs.mkdirSync(sub, { recursive: true });
        // realpathSync normalizes /private symlink prefixes on macOS tmp dirs.
        expect(findProjectRoot(sub)).toBe(fs.realpathSync(root));
    });

    it('finds the root via package.json', () => {
        const root = tmpRoot();
        fs.writeFileSync(path.join(root, 'package.json'), '{}');
        expect(findProjectRoot(root)).toBe(fs.realpathSync(root));
    });

    it('finds the root via .awm/profile.json', () => {
        const root = tmpRoot();
        fs.mkdirSync(path.join(root, '.awm'));
        fs.writeFileSync(path.join(root, '.awm', 'profile.json'), '{"extensions":[]}');
        expect(findProjectRoot(root)).toBe(fs.realpathSync(root));
    });

    it('returns null when no marker is found up to the filesystem root', () => {
        const root = tmpRoot(); // bare tmp dir, no markers
        expect(findProjectRoot(root)).toBeNull();
    });
});

describe('readProfile / writeProfile / addExtension', () => {
    it('returns an empty profile when none exists', () => {
        const root = tmpRoot();
        expect(readProfile(root)).toEqual({ extensions: [] });
    });

    it('round-trips a written profile', () => {
        const root = tmpRoot();
        writeProfile(root, { extensions: ['frontend'] });
        expect(readProfile(root)).toEqual({ extensions: ['frontend'] });
        expect(fs.existsSync(path.join(root, '.awm', 'profile.json'))).toBe(true);
    });

    it('addExtension appends and dedupes', () => {
        const root = tmpRoot();
        addExtension(root, 'frontend');
        addExtension(root, 'frontend');
        addExtension(root, 'docs');
        expect(readProfile(root).extensions).toEqual(['frontend', 'docs']);
    });

    it('tolerates a malformed extensions field', () => {
        const root = tmpRoot();
        fs.mkdirSync(path.join(root, '.awm'));
        fs.writeFileSync(path.join(root, '.awm', 'profile.json'), '{"extensions":"oops"}');
        expect(readProfile(root)).toEqual({ extensions: [] });
    });
});

describe('ensureSkillsGitignored', () => {
    it('appends the pattern when .gitignore is absent', () => {
        const root = tmpRoot();
        ensureSkillsGitignored(root);
        const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8');
        expect(gi.split(/\r?\n/)).toContain('.claude/skills/');
    });

    it('is idempotent and preserves existing entries', () => {
        const root = tmpRoot();
        fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules\n');
        ensureSkillsGitignored(root);
        ensureSkillsGitignored(root);
        const lines = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8').split(/\r?\n/);
        expect(lines).toContain('node_modules');
        expect(lines.filter((l) => l.trim() === '.claude/skills/').length).toBe(1);
    });

    it('does not duplicate when the unslashed variant already exists', () => {
        const root = tmpRoot();
        fs.writeFileSync(path.join(root, '.gitignore'), '.claude/skills\n');
        ensureSkillsGitignored(root);
        const lines = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8').split(/\r?\n/);
        expect(lines.filter((l) => l.trim().startsWith('.claude/skills')).length).toBe(1);
    });
});

describe('shouldRecordExtension', () => {
    it('records only project-scope bundles installed locally', () => {
        expect(shouldRecordExtension('project', 'local')).toBe(true);
        expect(shouldRecordExtension('project', 'global')).toBe(false);
        expect(shouldRecordExtension('baseline', 'global')).toBe(false);
        expect(shouldRecordExtension('baseline', 'local')).toBe(false);
        expect(shouldRecordExtension('ambient', 'global')).toBe(false);
    });
});
