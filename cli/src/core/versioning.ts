// src/core/versioning.ts
//
// Resolver de versiones por tags semver — WS-3. Sin estado propio: git es la
// única fuente de verdad (la versión vigente se deriva de `git describe`).
import simpleGit, { SimpleGit } from 'simple-git';
import { getPreferences } from '../utils/config';

export type Channel = 'stable' | 'dev';

export type ResolvedRef =
    | { kind: 'tag'; ref: string; version: string }   // ref = "vX.Y.Z", version sin prefijo
    | { kind: 'head'; ref: string }                    // canal dev — ref = default branch
    | { kind: 'head-fallback'; ref: string };          // stable sin tags — el caller avisa

const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

export function normalizePin(pin: string): string {
    return pin.replace(/^v/, '');
}

function semverKey(tag: string): [number, number, number] {
    const m = TAG_RE.exec(tag)!;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function bySemverAsc(a: string, b: string): number {
    const [a1, a2, a3] = semverKey(a);
    const [b1, b2, b3] = semverKey(b);
    return a1 - b1 || a2 - b2 || a3 - b3;
}

async function defaultBranch(git: SimpleGit): Promise<string> {
    try {
        const ref = (await git.raw(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
        const name = ref.split('/').slice(1).join('/');
        if (name) return name;
    } catch {
        // origin/HEAD puede no estar seteado — probar candidatos
    }
    for (const cand of ['main', 'master']) {
        try {
            await git.raw(['rev-parse', '--verify', `origin/${cand}`]);
            return cand;
        } catch {
            // siguiente candidato
        }
    }
    return 'main';
}

/** Tags semver vX.Y.Z del repo, orden ascendente. Hace fetch --tags --prune primero. */
async function fetchVersionTags(git: SimpleGit): Promise<string[]> {
    await git.raw(['fetch', '--tags', '--prune', 'origin']);
    const tags = (await git.tags()).all.filter((t) => TAG_RE.test(t));
    return tags.sort(bySemverAsc);
}

/**
 * Resuelve a qué ref debe quedar checkouteado un registry clonado:
 * pin declarado > último tag semver (canal stable) > HEAD (canal dev o repo sin tags).
 */
export async function resolveTargetRef(
    repoDir: string,
    opts: { pin?: string; channel: Channel }
): Promise<ResolvedRef> {
    const git = simpleGit(repoDir);
    const tags = await fetchVersionTags(git);

    if (opts.pin) {
        const want = `v${normalizePin(opts.pin)}`;
        if (!tags.includes(want)) {
            const available = tags.length > 0
                ? `available versions: ${tags.join(', ')}`
                : 'the registry has no version tags';
            throw new Error(`Pinned version ${want} not found in ${repoDir} — ${available}`);
        }
        return { kind: 'tag', ref: want, version: normalizePin(opts.pin) };
    }

    const branch = await defaultBranch(git);
    if (opts.channel === 'dev') return { kind: 'head', ref: branch };
    if (tags.length === 0) return { kind: 'head-fallback', ref: branch };

    const latest = tags[tags.length - 1];
    return { kind: 'tag', ref: latest, version: latest.slice(1) };
}

/** Versión checkouteada actual ("X.Y.Z") si HEAD coincide exactamente con un tag semver; null si sigue un branch. */
export async function currentVersion(repoDir: string): Promise<string | null> {
    try {
        const out = (await simpleGit(repoDir).raw(['describe', '--tags', '--exact-match', 'HEAD'])).trim();
        return TAG_RE.test(out) ? out.slice(1) : null;
    } catch {
        return null;
    }
}

/** Opts de versionado de la máquina para un registry ('base' reservado), desde preferences.
 *  Preferences ilegibles → defaults (stable, sin pin) — patrón de resolveBaseRemoteInfo. */
export function machineVersionOpts(registryName: string): { pin?: string; channel: Channel } {
    try {
        const prefs = getPreferences();
        const channel: Channel = prefs.channel === 'dev' ? 'dev' : 'stable';
        const pin = prefs.pins && typeof prefs.pins[registryName] === 'string'
            ? prefs.pins[registryName]
            : undefined;
        return { pin, channel };
    } catch {
        return { pin: undefined, channel: 'stable' };
    }
}

/** Compara "X.Y.Z" vs "X.Y.Z" (sin prefijo v) numéricamente. <0, 0, >0. */
export function compareSemver(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    return (pa[0] - pb[0]) || (pa[1] - pb[1]) || (pa[2] - pb[2]);
}
