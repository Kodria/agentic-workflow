import fs from 'fs';
import path from 'path';
import { writeFileAtomic } from '../atomic-file';
import { awmHome, sameExistingPath } from '../paths';
import { contentRoots } from '../registries';
import type { FactDefinition, FactsCatalog } from '../facts/types';

export type StoredFactStatus = 'fresh' | 'stale' | 'missing';

export interface StoredFactValue {
    value: string;
    status: StoredFactStatus;
    updatedAt: string;
    expiresAt?: string;
}

export type EnvironmentValues = Record<string, StoredFactValue>;

export interface WriteFactOptions {
    definition?: FactDefinition;
    catalog?: FactsCatalog;
    consultedRoots?: string[];
    registryRoots?: string[];
}

export interface WriteEnvValueOptions {
    registryRoots?: string[];
}

export class EnvironmentStoreError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'EnvironmentStoreError';
    }
}

const DEFAULT_ENV_NAME = 'default';
const META_FILE = 'meta.json';
const VALUES_FILE = 'values.json';

interface EnvironmentsMeta {
    active: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Root of machine-local environment stores: `AWM_HOME/environments`. */
export function environmentsRoot(): string {
    return path.join(awmHome(), 'environments');
}

export function envDir(name: string): string {
    assertEnvName(name);
    return path.join(environmentsRoot(), name);
}

export function valuesPath(name: string): string {
    return path.join(envDir(name), VALUES_FILE);
}

function metaPath(): string {
    return path.join(environmentsRoot(), META_FILE);
}

function assertEnvName(name: string): void {
    if (typeof name !== 'string' || name.trim() === '') {
        throw new EnvironmentStoreError('environment name must be a non-empty string');
    }
    if (name.includes('\0')) {
        throw new EnvironmentStoreError(`Invalid environment name ${JSON.stringify(name)}: NUL byte`);
    }
    if (name === META_FILE || name === VALUES_FILE) {
        throw new EnvironmentStoreError(
            `Invalid environment name ${JSON.stringify(name)}: reserved store filename`,
        );
    }
    if (name.includes('/') || name.includes('\\') || name.includes('..') || name === '.' || name === '..') {
        throw new EnvironmentStoreError(`Invalid environment name ${JSON.stringify(name)}`);
    }
}

function readMeta(): EnvironmentsMeta | null {
    const file = metaPath();
    if (!fs.existsSync(file)) return null;
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
        throw new EnvironmentStoreError(
            `Invalid environments meta at ${file}: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
    if (!isRecord(raw) || typeof raw.active !== 'string' || raw.active.trim() === '') {
        throw new EnvironmentStoreError(`Invalid environments meta at ${file}: expected { active: string }`);
    }
    return { active: raw.active };
}

function writeMeta(meta: EnvironmentsMeta): void {
    const file = metaPath();
    assertNotInsideRegistryTree(file);
    writeFileAtomic(file, JSON.stringify(meta, null, 2) + '\n');
}

/** Exactly one active environment per machine; default name `default` (RF-2.2). */
export function getActiveEnvironmentName(): string {
    const meta = readMeta();
    if (!meta) return DEFAULT_ENV_NAME;
    assertEnvName(meta.active);
    return meta.active;
}

export function setActiveEnvironmentName(name: string): void {
    assertEnvName(name);
    writeMeta({ active: name });
}

function parseStoredEntry(id: string, raw: unknown): StoredFactValue {
    if (!isRecord(raw)) {
        throw new EnvironmentStoreError(`values.${id} must be an object`);
    }
    if (typeof raw.value !== 'string') {
        throw new EnvironmentStoreError(`values.${id}.value must be a string`);
    }
    if (raw.status !== 'fresh' && raw.status !== 'stale' && raw.status !== 'missing') {
        throw new EnvironmentStoreError(`values.${id}.status must be fresh|stale|missing`);
    }
    if (typeof raw.updatedAt !== 'string') {
        throw new EnvironmentStoreError(`values.${id}.updatedAt must be a string`);
    }
    const entry: StoredFactValue = {
        value: raw.value,
        status: raw.status,
        updatedAt: raw.updatedAt,
    };
    if (raw.expiresAt !== undefined) {
        if (typeof raw.expiresAt !== 'string') {
            throw new EnvironmentStoreError(`values.${id}.expiresAt must be a string`);
        }
        entry.expiresAt = raw.expiresAt;
    }
    return entry;
}

export function readValues(name: string): EnvironmentValues {
    const file = valuesPath(name);
    if (!fs.existsSync(file)) return {};
    let raw: unknown;
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch (e) {
        throw new EnvironmentStoreError(
            `Invalid values.json at ${file}: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
    if (!isRecord(raw)) {
        throw new EnvironmentStoreError(`values.json at ${file} must be a JSON object`);
    }
    const out: EnvironmentValues = {};
    for (const [id, entry] of Object.entries(raw)) {
        out[id] = parseStoredEntry(id, entry);
    }
    return out;
}

/**
 * Resolve a path through any intermediate symlinks (including when the leaf does
 * not exist yet). Walks up to the nearest existing ancestor, realpaths it, then
 * re-appends missing segments — same spirit as sensors/ledger realpath containment.
 */
function resolvePathForContainment(targetPath: string): string {
    const absolute = path.resolve(targetPath);
    const missing: string[] = [];
    let cursor = absolute;
    while (!fs.existsSync(cursor)) {
        const parent = path.dirname(cursor);
        if (parent === cursor) break;
        missing.unshift(path.basename(cursor));
        cursor = parent;
    }
    let realBase: string;
    try {
        realBase = fs.realpathSync.native(cursor);
    } catch {
        realBase = cursor;
    }
    return missing.length === 0 ? realBase : path.join(realBase, ...missing);
}

function isPathInsideRoot(candidate: string, root: string): boolean {
    if (sameExistingPath(candidate, root)) return true;
    const rel = path.relative(root, candidate);
    if (rel === '') return true;
    if (rel === '..') return false;
    if (!rel.startsWith(`..${path.sep}`) && !rel.startsWith('..') && !path.isAbsolute(rel)) return true;
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    return candidate === root || candidate.startsWith(prefix);
}

/**
 * True when `targetPath` (after resolving symlinks) is the same as or nested under
 * any registry content root. Catches AWM_HOME/environments → registry symlink (RNF-1).
 *
 * Always unions `contentRoots()` with any explicit `registryRoots`. An empty
 * explicit array no longer disables checks — callers that need extra roots pass
 * them; they cannot opt out of installed content roots.
 */
export function isInsideRegistryTree(targetPath: string, registryRoots?: string[]): boolean {
    if (typeof targetPath !== 'string' || targetPath.trim() === '') {
        throw new EnvironmentStoreError('target path must be a non-empty string');
    }
    const lexicalTarget = path.resolve(targetPath);
    const realTarget = resolvePathForContainment(targetPath);
    const roots = [...contentRoots(), ...(registryRoots ?? [])];
    for (const root of roots) {
        if (typeof root !== 'string' || root.trim() === '') continue;
        const lexicalRoot = path.resolve(root);
        const realRoot = resolvePathForContainment(root);
        if (isPathInsideRoot(realTarget, realRoot)) return true;
        // Also check lexical forms so non-existent trees still refuse obvious nesting.
        if (isPathInsideRoot(lexicalTarget, lexicalRoot)) return true;
    }
    return false;
}

export function assertNotInsideRegistryTree(targetPath: string, registryRoots?: string[]): void {
    if (isInsideRegistryTree(targetPath, registryRoots)) {
        throw new EnvironmentStoreError(
            `Refusing to write environment store inside a registry tree: ${targetPath} (RNF-1)`,
        );
    }
}

/**
 * Atomic write of a values.json document. Refuses targets under registry roots (RNF-1).
 */
export function writeEnvValue(
    targetPath: string,
    values: EnvironmentValues,
    opts: WriteEnvValueOptions = {},
): void {
    if (typeof targetPath !== 'string' || targetPath.trim() === '') {
        throw new EnvironmentStoreError('target path must be a non-empty string');
    }
    if (!isRecord(values)) {
        throw new EnvironmentStoreError('values must be an object');
    }
    for (const [id, entry] of Object.entries(values)) {
        parseStoredEntry(id, entry);
    }
    // RNF-1: refuse registry-tree targets. Callers that need environmentsRoot placement
    // (writeFact) pass valuesPath(name); this helper does not re-check environmentsRoot.
    assertNotInsideRegistryTree(targetPath, opts.registryRoots);
    writeFileAtomic(targetPath, JSON.stringify(values, null, 2) + '\n');
}

function validateValue(definition: FactDefinition, value: string): void {
    if (definition.valueType === 'path') {
        if (value.trim() === '') {
            throw new EnvironmentStoreError('path value must be a non-empty string');
        }
    }
    if (definition.valueType === 'enum') {
        const allowed = definition.values ?? [];
        if (!allowed.includes(value)) {
            throw new EnvironmentStoreError(
                `enum value ${JSON.stringify(value)} is not one of: ${allowed.join(', ')}`,
            );
        }
    }
}

function withExpiresAt(
    entry: StoredFactValue,
    definition: FactDefinition | undefined,
): StoredFactValue {
    if (!definition || definition.durability !== 'volatile') {
        return {
            value: entry.value,
            status: entry.status,
            updatedAt: entry.updatedAt,
        };
    }
    if (typeof definition.ttl !== 'number' || !Number.isFinite(definition.ttl) || definition.ttl <= 0) {
        throw new EnvironmentStoreError('volatile fact definition requires a finite ttl > 0');
    }
    const ttlSeconds = definition.ttl;
    const updatedMs = Date.parse(entry.updatedAt);
    if (!Number.isFinite(updatedMs)) {
        throw new EnvironmentStoreError(`updatedAt must be a valid ISO timestamp, got ${JSON.stringify(entry.updatedAt)}`);
    }
    let expiresAt: string;
    try {
        expiresAt = new Date(updatedMs + ttlSeconds * 1000).toISOString();
    } catch (e) {
        if (e instanceof RangeError) {
            throw new EnvironmentStoreError(
                `volatile expiresAt out of range for updatedAt=${JSON.stringify(entry.updatedAt)} ttl=${ttlSeconds}`,
            );
        }
        throw e;
    }
    return { ...entry, expiresAt };
}

/**
 * Write one fact into `environments/<name>/values.json` (RF-2.1). Atomic rename.
 * When `catalog` is provided, unknown ids error and list `consultedRoots`.
 */
export function writeFact(
    name: string,
    id: string,
    entry: StoredFactValue,
    opts: WriteFactOptions = {},
): void {
    assertEnvName(name);
    if (typeof id !== 'string' || id.trim() === '') {
        throw new EnvironmentStoreError('fact id must be a non-empty string');
    }
    if (!isRecord(entry) || typeof entry.value !== 'string') {
        throw new EnvironmentStoreError('fact entry.value must be a string');
    }
    if (entry.status !== 'fresh' && entry.status !== 'stale' && entry.status !== 'missing') {
        throw new EnvironmentStoreError('fact entry.status must be fresh|stale|missing');
    }
    if (typeof entry.updatedAt !== 'string') {
        throw new EnvironmentStoreError('fact entry.updatedAt must be a string');
    }

    let definition = opts.definition;
    if (opts.catalog) {
        // Own keys only — prototype members (toString, …) are not catalog facts.
        if (!Object.hasOwn(opts.catalog.facts, id)) {
            const roots = opts.consultedRoots?.length
                ? opts.consultedRoots.join(', ')
                : '(no catalog roots)';
            throw new EnvironmentStoreError(
                `Unknown fact id ${JSON.stringify(id)}; consulted: ${roots}`,
            );
        }
        definition = definition ?? opts.catalog.facts[id];
    }
    if (definition) {
        validateValue(definition, entry.value);
    }

    const nextEntry = withExpiresAt(
        {
            value: entry.value,
            status: entry.status,
            updatedAt: entry.updatedAt,
            ...(entry.expiresAt !== undefined ? { expiresAt: entry.expiresAt } : {}),
        },
        definition,
    );

    const file = valuesPath(name);
    assertNotInsideRegistryTree(file, opts.registryRoots);
    const current = readValues(name);
    const next: EnvironmentValues = { ...current, [id]: nextEntry };
    writeEnvValue(file, next, { registryRoots: opts.registryRoots });

    // First write materializes the single active env as the env being written (RF-2.2).
    if (!readMeta()) {
        writeMeta({ active: name });
    }
}
