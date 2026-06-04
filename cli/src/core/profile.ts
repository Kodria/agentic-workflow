// src/core/profile.ts
import fs from 'fs';
import path from 'path';
import type { BundleScope } from './bundles';
import type { Scope } from '../providers';

export interface ProjectProfile {
    extensions: string[];
}

const GITIGNORE_ENTRY = '.claude/skills/';

/**
 * Walks up from `startDir` looking for a project root marker
 * (`.git/`, `package.json`, or `.awm/profile.json`). Returns the
 * absolute (realpath) directory, or null if none is found.
 */
export function findProjectRoot(startDir: string): string | null {
    let dir = fs.realpathSync(path.resolve(startDir));
    // eslint-disable-next-line no-constant-condition
    while (true) {
        if (
            fs.existsSync(path.join(dir, '.git')) ||
            fs.existsSync(path.join(dir, 'package.json')) ||
            fs.existsSync(path.join(dir, '.awm', 'profile.json'))
        ) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

function profilePath(root: string): string {
    return path.join(root, '.awm', 'profile.json');
}

export function readProfile(root: string): ProjectProfile {
    const file = profilePath(root);
    if (!fs.existsSync(file)) return { extensions: [] };
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
        return { extensions: Array.isArray(raw.extensions) ? raw.extensions : [] };
    } catch {
        return { extensions: [] };
    }
}

export function writeProfile(root: string, profile: ProjectProfile): void {
    const dir = path.join(root, '.awm');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(profilePath(root), JSON.stringify(profile, null, 2) + '\n', 'utf-8');
}

/** Adds a bundle name to the profile's extensions (deduped) and persists it. */
export function addExtension(root: string, name: string): ProjectProfile {
    const profile = readProfile(root);
    if (!profile.extensions.includes(name)) profile.extensions.push(name);
    writeProfile(root, profile);
    return profile;
}

/**
 * Ensures the project's .gitignore ignores the local skill symlinks
 * (machine-specific; rebuilt by `awm sync`). Idempotent.
 */
export function ensureSkillsGitignored(root: string): void {
    const gi = path.join(root, '.gitignore');
    const existing = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf-8') : '';
    const alreadyIgnored = existing
        .split(/\r?\n/)
        .some((l) => l.trim() === '.claude/skills/' || l.trim() === '.claude/skills');
    if (alreadyIgnored) return;
    const needsNewline = existing.length > 0 && !existing.endsWith('\n');
    fs.appendFileSync(gi, `${needsNewline ? '\n' : ''}${GITIGNORE_ENTRY}\n`);
}

/**
 * A bundle is recorded as a project extension only when it is a `project`-scope
 * bundle being installed locally. Baseline/ambient and global installs are not
 * project extensions and stay out of `.awm/profile.json`.
 */
export function shouldRecordExtension(bundleScope: BundleScope, effective: Scope): boolean {
    return bundleScope === 'project' && effective === 'local';
}
