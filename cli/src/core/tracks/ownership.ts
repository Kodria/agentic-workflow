import path from 'path';
import type { ParsedTrack } from './plan-parser';
import type { ChangedPath } from './git';

const GLOBAL = [
    { kind: 'lockfile', re: /(^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock)$/i },
    { kind: 'manifest', re: /(^|\/)(?:package\.json|Cargo\.toml|pyproject\.toml)$/i },
    { kind: 'migration', re: /(^|\/)(?:migrations?|schema)\//i },
    { kind: 'snapshot', re: /(?:^|\/)(__snapshots__\/|[^/]+\.snap$)/i },
    { kind: 'generated', re: /(^|\/)(?:dist|generated|coverage)\//i },
] as const;

const canon = (p: string): string => path.posix.normalize(p.replaceAll('\\', '/')).replace(/^\.\//, '');
const key = (p: string): string => canon(p).toLocaleLowerCase('en-US');
const GLOB_CHARS = /[*?[\]{}]/;

/**
 * Formas soportadas: `dir/sub/file.ts`, `dir/`, `dir/*`, `dir/**`. Cualquier otro glob
 * (intermedio, `?`, clases, llaves) se rechaza: un patrón que no sabemos expandir no puede
 * usarse para AFIRMAR que dos tracks no se pisan.
 */
export function ownershipPrefix(owner: string): string {
    const trimmed = canon(owner).replace(/\/(?:\*\*|\*)$/, '/');
    if (GLOB_CHARS.test(trimmed)) throw new Error(`ownership no soporta este glob: ${owner}`);
    return key(trimmed);
}

const covers = (owner: string, actual: string): boolean => {
    const o = ownershipPrefix(owner);
    const a = key(actual);
    return o.endsWith('/') ? a === o.slice(0, -1) || a.startsWith(o) : a === o;
};

/** Un patrón inexpandible cuenta como intersección: nunca habilita paralelismo por ignorancia. */
const intersects = (left: string, right: string): boolean => {
    try { return covers(left, right) || covers(right, left); } catch { return true; }
};

/** Simétrico del anterior: un patrón inexpandible nunca prueba propiedad. */
const proves = (owner: string, actual: string): boolean => {
    try { return covers(owner, actual); } catch { return false; }
};

export function canonicalResource(raw: string): string {
    const match = raw.match(/^([a-z][a-z0-9-]*):(.+)$/i);
    if (match === null || match[2].trim().length === 0) throw new Error(`recurso debe usar <clase>:<valor>: ${raw}`);
    // Case-fold el valor igual que `key()` hace con paths: sin esto, `db:Dev`
    // y `db:dev` producen strings distintos y el Set.has() de
    // assessDeclaredIndependence no detecta la colision (fail-open).
    return `${match[1].toLowerCase()}:${match[2].trim().toLocaleLowerCase('en-US')}`;
}

export function assessDeclaredIndependence(tracks: ParsedTrack[]): { parallel: boolean; reasons: string[] } {
    const reasons = new Set<string>();
    for (const t of tracks) {
        for (const owner of t.ownership) {
            try { ownershipPrefix(owner); } catch { reasons.add(`unsupported-glob:${canon(owner)}`); }
            const global = GLOBAL.find((g) => g.re.test(canon(owner)));
            if (global !== undefined) reasons.add(`global:${global.kind}:${canon(owner)}`);
        }
    }
    for (let i = 0; i < tracks.length; i++) for (let j = i + 1; j < tracks.length; j++) {
        for (const left of tracks[i].ownership) for (const right of tracks[j].ownership) {
            if (intersects(left, right)) reasons.add(`path:${canon(right)}`);
        }
        const rightResources = new Set(tracks[j].sharedResources.map(canonicalResource));
        for (const resource of tracks[i].sharedResources.map(canonicalResource)) {
            if (rightResources.has(resource)) reasons.add(`resource:${resource}`);
        }
    }
    return { parallel: reasons.size === 0, reasons: [...reasons].sort() };
}

export function assessActualOwnership(track: ParsedTrack, changes: ChangedPath[]): { outsideOwnership: string[]; globalClasses: string[] } {
    const actual = changes.flatMap((c) => c.oldPath === undefined ? [c.path] : [c.oldPath, c.path]);
    return {
        outsideOwnership: actual.filter((p) => !track.ownership.some((o) => proves(o, p))).sort(),
        globalClasses: actual.flatMap((p) => GLOBAL.filter((g) => g.re.test(canon(p))).map((g) => `${g.kind}:${canon(p)}`)).sort(),
    };
}
