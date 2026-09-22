import { execFile } from 'child_process';
import { promisify } from 'util';
import { CLI_PACKAGE_NAME, cliVersion } from '../cli-version';
import { listRegistries, type RegistrySource } from '../registries';
import { readPreferences } from '../../utils/config';
import type { CurrentnessComponent, CurrentnessDeps, CurrentnessReport, GitTransport } from './types';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 2_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const NPM_SOURCE = `https://registry.npmjs.org/${CLI_PACKAGE_NAME}/latest`;
const STRICT_SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function deadline<T>(operation: Promise<T>, timeoutMs = TIMEOUT_MS): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('currentness transport timed out')), timeoutMs);
    });
    return Promise.race([operation, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function bounded(value: string, limit = 512): string {
    return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function authoritativeSource(value: string): string | null {
    try {
        const url = new URL(value);
        // HTTPS userinfo is a credential-bearing transport URL. Reject it before
        // constructing any Git argv, rather than merely redacting it for output.
        if (url.protocol === 'https:' && url.hostname && !url.username && !url.password && !url.search && !url.hash) {
            return bounded(`https://${url.host}${url.pathname}`);
        }
        if (url.protocol === 'ssh:' && url.hostname && !url.password && !url.search && !url.hash) {
            return bounded(`ssh://${url.host}${url.pathname}`);
        }
        return null;
    } catch {
        // SCP-style Git remotes have no URL parser representation. Permit only an
        // intentionally narrow grammar and remove the optional userinfo; all other
        // schemes fail closed.
        const match = /^(?:[A-Za-z0-9._-]+@)?([A-Za-z0-9.-]+):([A-Za-z0-9._/-]+)$/.exec(value);
        return match
            ? bounded(`${match[1]}:${match[2]}`)
            : null;
    }
}

function sanitizeSource(value: string): string {
    return authoritativeSource(value) ?? '[configured remote]';
}

function sshUserInfoLabel(value: string): string {
    try {
        const url = new URL(value);
        if (url.protocol === 'ssh:') return url.username ? 'SSH userinfo present' : 'no SSH userinfo';
    } catch {
        if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._/-]+$/.test(value)) return 'SSH userinfo present';
    }
    return 'no SSH userinfo';
}

function parseVersion(value: string): [string, string, string] | null {
    const match = STRICT_SEMVER.exec(value.trim());
    if (!match) return null;
    return [match[1], match[2], match[3]];
}

function compareNumericIdentifier(a: string, b: string): number {
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
}

function compareStrict(a: string, b: string): number | null {
    const av = parseVersion(a);
    const bv = parseVersion(b);
    if (!av || !bv) return null;
    return compareNumericIdentifier(av[0], bv[0])
        || compareNumericIdentifier(av[1], bv[1])
        || compareNumericIdentifier(av[2], bv[2]);
}

function iso(now: () => number): string {
    const value = now();
    if (!Number.isFinite(value)) throw new Error('currentness clock must return a finite timestamp');
    return new Date(value).toISOString();
}

const defaultGit: GitTransport = async (cwd, args, options) => {
    const result = await execFileAsync('git', args, {
        cwd,
        timeout: options.timeoutMs,
        maxBuffer: options.maxOutputBytes,
        windowsHide: true,
    });
    return result.stdout;
};

function unavailable(component: string, source: string, checkedAt: string, installed: string | null, pin?: string): CurrentnessComponent {
    return {
        component, installed, latest: null, channel: 'stable', source, ...(pin ? { pin } : {}), checkedAt,
        status: 'unverifiable', detail: 'Authoritative currentness could not be verified.',
        remedy: 'Restore source access and rerun strict preflight.',
    };
}

async function latestCli(fetchImpl: typeof fetch): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const response = await deadline(fetchImpl(NPM_SOURCE, { signal: controller.signal }));
        if (!response.ok) return null;
        const text = await deadline(response.text());
        if (Buffer.byteLength(text, 'utf8') > MAX_OUTPUT_BYTES) return null;
        const body: unknown = JSON.parse(text);
        if (!body || typeof body !== 'object') return null;
        const latest = (body as Record<string, unknown>).version;
        return typeof latest === 'string' && parseVersion(latest) ? latest : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function latestStableTag(output: string): { tag: string; sha: string } | null {
    if (Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES) return null;
    const tags = new Map<string, { sha: string; peeled?: string }>();
    for (const line of output.split(/\r?\n/)) {
        const match = /^([0-9a-fA-F]{40,64})\trefs\/tags\/(v?\d+\.\d+\.\d+)(\^\{\})?$/.exec(line);
        if (!match) continue;
        const tag = tags.get(match[2]) ?? { sha: '' };
        if (match[3]) tag.peeled = match[1];
        else tag.sha = match[1];
        tags.set(match[2], tag);
    }
    let latest: { tag: string; sha: string } | null = null;
    for (const [tag, ref] of tags) {
        if (!ref.sha) continue;
        if (!latest || (compareStrict(tag, latest.tag) ?? -1) > 0) latest = { sha: ref.peeled ?? ref.sha, tag };
    }
    return latest;
}

async function registryComponent(registry: RegistrySource, git: GitTransport, prefs: ReturnType<typeof readPreferences>, checkedAt: string): Promise<CurrentnessComponent> {
    const authorizedSource = authoritativeSource(registry.remote);
    const source = authorizedSource ?? '[configured remote]';
    const pin = prefs.pins?.[registry.name];
    const fail = (detail: string, remedy: string, installed: string | null = null, latest: string | null = null): CurrentnessComponent => ({
        ...unavailable(`registry:${registry.name}`, source, checkedAt, installed, pin), latest, detail, remedy,
    });
    if (!authorizedSource) return fail('Configured registry remote is not an authoritative HTTPS or SSH source.', 'Configure an authoritative registry remote and rerun strict preflight.');

    const [originResult, headResult, tagResult, remoteResult] = await Promise.allSettled([
        deadline(git(registry.contentRoot, ['remote', 'get-url', 'origin'], { timeoutMs: TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES })),
        deadline(git(registry.contentRoot, ['rev-parse', 'HEAD'], { timeoutMs: TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES })),
        deadline(git(registry.contentRoot, ['describe', '--tags', '--exact-match', 'HEAD'], { timeoutMs: TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES })),
        deadline(git(registry.contentRoot, ['ls-remote', '--tags', registry.remote], { timeoutMs: TIMEOUT_MS, maxOutputBytes: MAX_OUTPUT_BYTES })),
    ]);
    if (originResult.status === 'rejected') return fail('Could not read local registry origin.', 'Inspect the local registry checkout and its origin remote.');
    if (headResult.status === 'rejected') return fail('Could not read local registry HEAD.', 'Inspect or repair the local registry checkout.');
    if (tagResult.status === 'rejected') return fail('Could not read an exact tag at local registry HEAD.', 'Check out a stable tag in the local registry and rerun strict preflight.');
    if (remoteResult.status === 'rejected') return fail('Could not query authoritative remote tags.', 'Restore source access and rerun strict preflight.');

    const installed = tagResult.value.trim();
    const latest = latestStableTag(remoteResult.value);
    const localHead = headResult.value.trim();
    const installedVersion = parseVersion(installed);
    if (!installedVersion) return fail('Local registry HEAD does not have an exact stable tag.', 'Check out a stable tag in the local registry and rerun strict preflight.');
    if (!latest) return fail('No stable version tag was found on the authoritative remote.', 'Publish a stable tag or correct the configured registry remote.', installed);
    if (!/^[0-9a-fA-F]{40,64}$/.test(localHead)) return fail('Local registry HEAD is not a valid commit SHA.', 'Inspect or repair the local registry checkout.', installed, latest.tag);
    if (originResult.value.trim() !== registry.remote) return fail(
        `Local origin does not match configured remote (origin: ${sanitizeSource(originResult.value.trim())} [${sshUserInfoLabel(originResult.value.trim())}]; configured: ${source} [${sshUserInfoLabel(registry.remote)}]).`,
        'Align the local origin with the configured registry remote and rerun strict preflight.', installed, latest.tag,
    );
    const relation = compareStrict(installed, latest.tag);
    if (relation === null) return fail('Stable registry tags could not be compared.', 'Inspect local and remote stable tags.', installed, latest.tag);
    if (relation === 0 && localHead === latest.sha) {
        return { component: `registry:${registry.name}`, installed, latest: latest.tag, channel: 'stable', source, ...(pin ? { pin } : {}), checkedAt, status: 'current', detail: 'Exact stable tag and configured origin match the authoritative remote.', remedy: 'No action required.' };
    }
    if (relation < 0) {
        return {
            component: `registry:${registry.name}`, installed, latest: latest.tag, channel: 'stable', source, ...(pin ? { pin } : {}), checkedAt,
            status: pin ? 'pinned-behind' : 'stale', detail: 'Installed stable tag is behind the authoritative remote.',
            remedy: pin ? `awm unpin ${registry.name} && awm update --yes` : 'awm update --yes',
        };
    }
    return fail('Installed stable tag is ahead of the authoritative remote or does not match its commit.', 'Inspect the local tag and authoritative remote before updating.', installed, latest.tag);
}

/** Strict, read-only remote currentness check. It intentionally never reads/writes update cache. */
export async function checkCurrentness(cwd: string, deps: CurrentnessDeps = {}): Promise<CurrentnessReport> {
    if (!cwd || typeof cwd !== 'string') throw new Error('currentness cwd must be a non-empty string');
    const now = deps.now ?? Date.now;
    const checkedAt = iso(now);
    const getCliVersion = deps.cliVersion ?? cliVersion;
    const fetchImpl = deps.fetch ?? fetch;
    const git = deps.git ?? defaultGit;
    const preferences = (deps.readPreferences ?? readPreferences)();

    const installedCli = getCliVersion();
    const latest = await latestCli(fetchImpl);
    const relation = latest ? compareStrict(installedCli, latest) : null;
    const cli: CurrentnessComponent = relation === null
        ? unavailable('cli', NPM_SOURCE, checkedAt, parseVersion(installedCli) ? installedCli : null)
        : relation === 0
            ? { component: 'cli', installed: installedCli, latest, channel: 'stable', source: NPM_SOURCE, checkedAt, status: 'current', detail: 'Installed version equals the npm latest release.', remedy: 'No action required.' }
            : relation < 0
                ? { component: 'cli', installed: installedCli, latest, channel: 'stable', source: NPM_SOURCE, checkedAt, status: 'stale', detail: 'Installed version is behind the npm latest release.', remedy: `npm i -g ${CLI_PACKAGE_NAME}@latest && rerun in a fresh process` }
                : { component: 'cli', installed: installedCli, latest, channel: 'stable', source: NPM_SOURCE, checkedAt, status: 'unverifiable', detail: 'Installed version is ahead of the npm latest release; remote currentness cannot be established.', remedy: 'Check the installed CLI version and npm latest metadata, then rerun strict preflight.' };

    const components = [cli];
    let registries: RegistrySource[];
    try {
        registries = (deps.listRegistries ?? listRegistries)();
        if (!Array.isArray(registries)) throw new Error('currentness registry inventory must be an array');
    } catch {
        components.push({
            ...unavailable('registry:inventory', '[configured registry inventory]', checkedAt, null),
            remedy: 'Repair the local registry inventory and rerun strict preflight.',
        });
        return { checkedAt, components, compatibility: { status: 'not-checked' } };
    }
    if (registries.length === 0) components.push(unavailable('registry:none', '[configured remote]', checkedAt, null));
    else for (const registry of registries) components.push(await registryComponent(registry, git, preferences, checkedAt));
    return { checkedAt, components, compatibility: { status: 'not-checked' } };
}

export { sanitizeSource };
