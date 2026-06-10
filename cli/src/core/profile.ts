// src/core/profile.ts
import fs from 'fs';
import path from 'path';
import type { BundleScope } from './bundles';
import type { Scope, ArtifactType, AgentTarget } from '../providers';
import { PROVIDERS } from '../providers';

export interface ProjectProfile {
    extensions: string[];
    /** Pin de versión por registry ('base' reservado). El pin del profile ES el lock del proyecto — WS-3. */
    registries?: Record<string, string>;
}

/**
 * Walks up from `startDir` looking for a project root marker
 * (`.git/`, `package.json`, or `.awm/profile.json`). Returns the
 * absolute (realpath) directory, or null if none is found.
 */
export function findProjectRoot(startDir: string): string | null {
    let dir: string;
    try {
        dir = fs.realpathSync(path.resolve(startDir));
    } catch {
        return null;
    }
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

const PIN_VERSION_RE = /^v?\d+\.\d+\.\d+$/;

export function readProfile(root: string): ProjectProfile {
    const file = profilePath(root);
    if (!fs.existsSync(file)) return { extensions: [] };
    let raw: Record<string, unknown>;
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
        // JSON corrupto: comportamiento lenient histórico (perfil vacío)
        return { extensions: [] };
    }
    const exts = Array.isArray(raw.extensions)
        ? (raw.extensions as unknown[]).filter((e): e is string => typeof e === 'string')
        : [];
    const profile: ProjectProfile = { extensions: exts };

    // El pin de proyecto es un contrato de versionado: malformado → error explícito
    // (consistente con readRegistryManifest de WS-2), nunca silenciar.
    if (raw.registries !== undefined) {
        if (typeof raw.registries !== 'object' || raw.registries === null || Array.isArray(raw.registries)) {
            throw new Error(`Invalid profile at ${file}: "registries" must be an object of name → version`);
        }
        const registries: Record<string, string> = {};
        for (const [name, version] of Object.entries(raw.registries as Record<string, unknown>)) {
            if (typeof version !== 'string' || !PIN_VERSION_RE.test(version)) {
                throw new Error(
                    `Invalid profile at ${file}: registries["${name}"] must be "X.Y.Z", got ${JSON.stringify(version)}`
                );
            }
            registries[name] = version.replace(/^v/, '');
        }
        profile.registries = registries;
    }
    return profile;
}

export function writeProfile(root: string, profile: ProjectProfile): void {
    const dir = path.join(root, '.awm');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(profilePath(root), JSON.stringify(profile, null, 2) + '\n', 'utf-8');
}

/**
 * Ensures `.awm/profile.json` exists, creating an empty `{ extensions: [] }`
 * profile when absent. Idempotent: a present profile (with any extensions) is
 * left untouched. Returns true only when it created the file.
 *
 * Without this, a project with no detectable extensions never gets a profile
 * written (`addExtension` is the only other writer, and it only runs when there
 * is something to add) — so `awm init` would leave the project flagged as
 * uninitialized and self-referentially suggest re-running `awm init`.
 */
export function ensureProfile(root: string): boolean {
    if (fs.existsSync(profilePath(root))) return false;
    writeProfile(root, { extensions: [] });
    return true;
}

/** Adds a bundle name to the profile's extensions (deduped) and persists it. */
export function addExtension(root: string, name: string): ProjectProfile {
    const profile = readProfile(root);
    if (!profile.extensions.includes(name)) profile.extensions.push(name);
    writeProfile(root, profile);
    return profile;
}

/**
 * Ensures the project's .gitignore ignores the local artifact symlinks for
 * all given agents (machine-specific; rebuilt by `awm sync`). Idempotent.
 */
export function ensureSkillsGitignored(root: string, agents: AgentTarget[]): void {
    const gi = path.join(root, '.gitignore');
    const existing = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf-8') : '';
    const existingLines = existing.split(/\r?\n/).map((l) => l.trim());

    const toIgnore: string[] = [];
    for (const agent of agents) {
        const provider = PROVIDERS[agent];
        for (const type of ['skill', 'workflow', 'agent'] as ArtifactType[]) {
            const config = provider[type];
            if (!config) continue;
            const entry = config.local.endsWith('/') ? config.local : `${config.local}/`;
            if (!toIgnore.includes(entry)) toIgnore.push(entry);
        }
    }

    const missing = toIgnore.filter(
        (e) => !existingLines.some((l) => l === e || l === e.replace(/\/$/, ''))
    );
    if (missing.length === 0) return;

    const needsNewline = existing.length > 0 && !existing.endsWith('\n');
    fs.appendFileSync(gi, `${needsNewline ? '\n' : ''}${missing.join('\n')}\n`);
}

/**
 * A bundle is recorded as a project extension only when it is a `project`-scope
 * bundle being installed locally. Baseline/ambient and global installs are not
 * project extensions and stay out of `.awm/profile.json`.
 */
export function shouldRecordExtension(bundleScope: BundleScope, effective: Scope): boolean {
    return bundleScope === 'project' && effective === 'local';
}
