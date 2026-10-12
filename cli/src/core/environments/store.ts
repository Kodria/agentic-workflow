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
    return meta?.active ?? DEFAULT_ENV_NAME;
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
 * True when `targetPath` is the same as or nested under any registry content root.
 * Used to refuse writing environment stores into registry git trees (RNF-1).
 */
export function isInsideRegistryTree(targetPath: string, registryRoots?: string[]): boolean {
    if (typeof targetPath !== 'string' || targetPath.trim() === '') {
        throw new EnvironmentStoreError('target path must be a non-empty string');
    }
    const resolvedTarget = path.resolve(targetPath);
    const roots = registryRoots ?? contentRoots();
    for (const root of roots) {
        if (typeof root !== 'string' || root.trim() === '') continue;
        const resolvedRoot = path.resolve(root);
        if (sameExistingPath(resolvedTarget, resolvedRoot)) return true;
        const rel = path.relative(resolvedRoot, resolvedTarget);
        if (rel === '') return true;
        if (!rel.startsWith('..') && !path.isAbsolute(rel)) return true;
        // Fallback when root does not exist yet: string prefix check on resolved paths.
        const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
        if (resolvedTarget === resolvedRoot || resolvedTarget.startsWith(prefix)) return true;
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
    const ttlSeconds = definition.ttl ?? 0;
    const updatedMs = Date.parse(entry.updatedAt);
    if (!Number.isFinite(updatedMs)) {
        throw new EnvironmentStoreError(`updatedAt must be a valid ISO timestamp, got ${JSON.stringify(entry.updatedAt)}`);
    }
    const expiresAt = new Date(updatedMs + ttlSeconds * 1000).toISOString();
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
        const fromCatalog = opts.catalog.facts[id];
        if (!fromCatalog) {
            const roots = opts.consultedRoots?.length
                ? opts.consultedRoots.join(', ')
                : '(no catalog roots)';
            throw new EnvironmentStoreError(
                `Unknown fact id ${JSON.stringify(id)}; consulted: ${roots}`,
            );
        }
        definition = definition ?? fromCatalog;
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

    // First write materializes the single active env name (default `default`) (RF-2.2).
    if (!readMeta()) {
        writeMeta({ active: DEFAULT_ENV_NAME });
    }
}
