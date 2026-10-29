import {
    listRegistries,
    validateRegistryLayout,
    type RegistrySyncResult,
} from './registries';
import { formatClassifiedRegistryFailure } from './registry-git-errors';
import { currentVersion } from './versioning';

export { formatClassifiedRegistryFailure };

export type SoftSyncFailureInput = {
    name: string;
    /** Semver without leading `v`, or null when unknown. */
    cachedVersion: string | null;
    /** Already-formatted SG-6 message (from formatClassifiedRegistryFailure). */
    classifiedMessage: string;
};

/**
 * Soft path for `awm add` / `awm list` (SG-7): continue on usable cache only after
 * stating the cached version plus the classified cause/remedy.
 */
export function formatRegistrySyncSoftFailure(input: SoftSyncFailureInput): string {
    const versionLabel = input.cachedVersion ? `v${input.cachedVersion}` : 'unknown';
    return (
        `⚠ registry ${input.name}: sync failed — continuing with cached version ${versionLabel}. `
        + input.classifiedMessage
    );
}

/** True when any per-registry sync result is an error (SG-7 hard-fail gate). */
export function hardFailOnAnyRegistrySyncError(results: RegistrySyncResult[]): boolean {
    return results.some((r) => r.action === 'error');
}

/**
 * Soft-failure lines for add/list: one per errored registry that still has usable
 * on-disk content. Callers print these then continue (or hard-fail via
 * assertSyncedRegistriesUsable when nothing usable remains).
 */
export async function formatSoftRegistrySyncFailures(
    results: RegistrySyncResult[],
    opts: {
        isUsable: (name: string) => boolean;
        cachedVersion: (name: string) => string | null | Promise<string | null>;
    },
): Promise<string[]> {
    const lines: string[] = [];
    for (const r of results) {
        if (r.action !== 'error') continue;
        if (!opts.isUsable(r.name)) continue;
        lines.push(formatRegistrySyncSoftFailure({
            name: r.name,
            cachedVersion: await opts.cachedVersion(r.name),
            classifiedMessage: r.error,
        }));
    }
    return lines;
}

/**
 * SG-7 soft path for `awm add` / `awm list`: warn with cached version + SG-6 text
 * for each failed-but-usable registry; warn with the classified error for
 * unusable ones (caller still runs assertSyncedRegistriesUsable for hard fail).
 */
export async function reportRegistrySyncSoftFailures(
    results: RegistrySyncResult[],
    log: (message: string) => void = (m) => console.warn(m),
): Promise<void> {
    const roots = new Map(listRegistries().map((r) => [r.name, r.contentRoot]));
    const soft = await formatSoftRegistrySyncFailures(results, {
        isUsable: (name) => {
            const root = roots.get(name);
            return root !== undefined && validateRegistryLayout(root);
        },
        cachedVersion: async (name) => {
            const root = roots.get(name);
            return root ? currentVersion(root) : null;
        },
    });
    for (const line of soft) log(line);
    for (const r of results) {
        if (r.action !== 'error') continue;
        const root = roots.get(r.name);
        if (root !== undefined && validateRegistryLayout(root)) continue;
        log(`  ⚠  registry ${r.name}: ${r.error}`);
    }
}
