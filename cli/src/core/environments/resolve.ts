import type { FactsCatalog } from '../facts/types';
import type { EnvironmentValues, StoredFactStatus, StoredFactValue } from './store';

/** Fixed budget for `inject: context` fresh values (RF-3.2). */
export const CONTEXT_INJECT_MAX_CHARS = 2048;

export type FactRuntimeStatus = 'fresh' | 'missing' | 'stale';

export interface BuildInjectionOptions {
    catalog: FactsCatalog;
    store: EnvironmentValues;
    storePath: string;
    /** Requested inject mode; default `reference` (RNF-2). */
    inject?: 'reference' | 'context';
    /** Override budget; defaults to {@link CONTEXT_INJECT_MAX_CHARS}. */
    maxChars?: number;
    now?: Date;
    /** Subset of catalog ids; default all catalog fact ids. */
    factIds?: string[];
}

export interface InjectionResult {
    mode: 'reference' | 'context';
    storePath: string;
    factIds: string[];
    /** Present only when mode is `context` and within budget. */
    values?: Record<string, string>;
    warning?: string;
}

function effectiveStatus(
    definitionDurability: 'durable' | 'volatile',
    stored: StoredFactValue | undefined,
    now: Date,
): FactRuntimeStatus {
    if (!stored) return 'missing';
    if (stored.status === 'missing') return 'missing';
    if (stored.status === 'stale') return 'stale';
    // Durable never time-stales (RF-2.3).
    if (definitionDurability === 'durable') {
        return stored.status === 'fresh' ? 'fresh' : stored.status;
    }
    // Volatile: stale if now > expiresAt (RF-2.4).
    if (stored.expiresAt) {
        const expiresMs = Date.parse(stored.expiresAt);
        if (Number.isFinite(expiresMs) && now.getTime() > expiresMs) {
            return 'stale';
        }
    }
    return stored.status === 'fresh' ? 'fresh' : stored.status;
}

/**
 * Per-catalog-id status against the store. Missing → `missing` with no default (RF-2.5).
 */
export function statusFor(
    catalog: FactsCatalog,
    store: EnvironmentValues,
    now: Date = new Date(),
): Record<string, FactRuntimeStatus> {
    if (!catalog || typeof catalog !== 'object' || !catalog.facts) {
        throw new Error('statusFor: catalog with facts is required');
    }
    if (!store || typeof store !== 'object') {
        throw new Error('statusFor: store must be an object');
    }
    const out: Record<string, FactRuntimeStatus> = {};
    for (const [id, def] of Object.entries(catalog.facts)) {
        out[id] = effectiveStatus(def.durability, store[id], now);
    }
    return out;
}

/**
 * Build injection payload. Default / explicit `reference` exposes path + ids only (RF-3.1).
 * `context` includes fresh `inject: context` values under budget; overflow degrades (RF-3.2).
 */
export function buildInjection(opts: BuildInjectionOptions): InjectionResult {
    if (!opts || typeof opts !== 'object') {
        throw new Error('buildInjection: options object is required');
    }
    if (!opts.catalog?.facts) {
        throw new Error('buildInjection: catalog with facts is required');
    }
    if (typeof opts.storePath !== 'string' || opts.storePath.trim() === '') {
        throw new Error('buildInjection: storePath must be a non-empty string');
    }
    if (!opts.store || typeof opts.store !== 'object') {
        throw new Error('buildInjection: store must be an object');
    }

    const inject = opts.inject ?? 'reference';
    const maxChars = opts.maxChars ?? CONTEXT_INJECT_MAX_CHARS;
    if (typeof maxChars !== 'number' || !Number.isFinite(maxChars) || maxChars < 0) {
        throw new Error('buildInjection: maxChars must be a non-negative finite number');
    }
    const now = opts.now ?? new Date();
    const factIds = opts.factIds ?? Object.keys(opts.catalog.facts);
    const statuses = statusFor(opts.catalog, opts.store, now);

    const referenceResult = (): InjectionResult => ({
        mode: 'reference',
        storePath: opts.storePath,
        factIds: [...factIds],
    });

    if (inject === 'reference') {
        return referenceResult();
    }

    // Context mode: only fresh values whose catalog inject is `context` (RF-3.2).
    const contextValues: Record<string, string> = {};
    let totalChars = 0;
    for (const id of factIds) {
        const def = opts.catalog.facts[id];
        if (!def || def.inject !== 'context') continue;
        if (statuses[id] !== 'fresh') continue;
        const stored = opts.store[id];
        if (!stored || typeof stored.value !== 'string') continue;
        totalChars += stored.value.length;
        contextValues[id] = stored.value;
    }

    if (Object.keys(contextValues).length === 0) {
        return referenceResult();
    }

    if (totalChars > maxChars) {
        return {
            ...referenceResult(),
            warning: `Context inject budget exceeded (${totalChars} > ${maxChars} chars); degraded to reference`,
        };
    }

    return {
        mode: 'context',
        storePath: opts.storePath,
        factIds: [...factIds],
        values: contextValues,
    };
}

/** Re-export status alias used by callers that want the stored shape name. */
export type { StoredFactStatus };
