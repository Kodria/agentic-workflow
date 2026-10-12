import fs from 'fs';
import { assertRegularRegistryFile } from '../registries';
import {
    FACT_ID_RE,
    FactDefinition,
    FactDurability,
    FactInject,
    FactResolution,
    FactValueType,
    FactsCatalog,
    FactsCatalogError,
} from './types';

const VALUE_TYPES: readonly FactValueType[] = ['string', 'path', 'enum'];
const RESOLUTIONS: readonly FactResolution[] = ['prompt'];
const DURABILITIES: readonly FactDurability[] = ['durable', 'volatile'];
const INJECTS: readonly FactInject[] = ['reference', 'context'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFactEntry(id: string, raw: unknown): FactDefinition {
    if (!FACT_ID_RE.test(id)) {
        throw new FactsCatalogError(`Invalid fact id ${JSON.stringify(id)}: must match ${FACT_ID_RE}`);
    }
    if (!isRecord(raw)) {
        throw new FactsCatalogError(`facts.${id} must be an object`);
    }
    if (typeof raw.valueType !== 'string' || !VALUE_TYPES.includes(raw.valueType as FactValueType)) {
        throw new FactsCatalogError(`facts.${id}.valueType must be one of ${VALUE_TYPES.join(', ')}`);
    }
    const valueType = raw.valueType as FactValueType;

    if (raw.resolution === 'command') {
        throw new FactsCatalogError(
            `facts.${id}: resolution: command is not supported in v1 (use prompt / --value / editable store)`,
        );
    }
    if (raw.resolution !== undefined) {
        if (typeof raw.resolution !== 'string' || !RESOLUTIONS.includes(raw.resolution as FactResolution)) {
            throw new FactsCatalogError(`facts.${id}.resolution must be "prompt" in v1`);
        }
    }
    if (raw.durability !== undefined) {
        if (typeof raw.durability !== 'string' || !DURABILITIES.includes(raw.durability as FactDurability)) {
            throw new FactsCatalogError(`facts.${id}.durability must be durable|volatile`);
        }
    }
    if (raw.inject !== undefined) {
        if (typeof raw.inject !== 'string' || !INJECTS.includes(raw.inject as FactInject)) {
            throw new FactsCatalogError(`facts.${id}.inject must be reference|context`);
        }
    }

    const def: FactDefinition = {
        valueType,
        resolution: (raw.resolution as FactResolution | undefined) ?? 'prompt',
        durability: (raw.durability as FactDurability | undefined) ?? 'durable',
        inject: (raw.inject as FactInject | undefined) ?? 'reference',
    };
    if (raw.description !== undefined) {
        if (typeof raw.description !== 'string') {
            throw new FactsCatalogError(`facts.${id}.description must be a string`);
        }
        def.description = raw.description;
    }
    if (valueType === 'enum') {
        if (!Array.isArray(raw.values) || raw.values.length === 0 || raw.values.some((v) => typeof v !== 'string')) {
            throw new FactsCatalogError(`facts.${id}.values must be a non-empty string array when valueType is enum`);
        }
        def.values = raw.values as string[];
    } else if (raw.values !== undefined) {
        throw new FactsCatalogError(`facts.${id}.values is only allowed when valueType is enum`);
    }
    if (raw.ttl !== undefined) {
        if (typeof raw.ttl !== 'number' || !Number.isFinite(raw.ttl) || raw.ttl < 0) {
            throw new FactsCatalogError(`facts.${id}.ttl must be a non-negative number`);
        }
        def.ttl = raw.ttl;
    }
    return def;
}

function parseObject(raw: unknown): FactsCatalog {
    if (!isRecord(raw)) {
        throw new FactsCatalogError('facts catalog must be a JSON object');
    }
    if (raw.schemaVersion !== 1) {
        throw new FactsCatalogError(`facts catalog schemaVersion must be 1, got ${JSON.stringify(raw.schemaVersion)}`);
    }
    if (!isRecord(raw.facts)) {
        throw new FactsCatalogError('facts catalog must include a facts object');
    }
    const facts: Record<string, FactDefinition> = {};
    for (const [id, entry] of Object.entries(raw.facts)) {
        if (id === '') {
            throw new FactsCatalogError('fact id must be non-empty');
        }
        facts[id] = parseFactEntry(id, entry);
    }
    return { schemaVersion: 1, facts };
}

/**
 * Parse a facts catalog from an in-memory object or from a file path string.
 * Named errors: {@link FactsCatalogError}.
 */
export function parseFactsCatalog(rawOrPath: unknown): FactsCatalog {
    if (typeof rawOrPath === 'string') {
        try {
            if (!assertRegularRegistryFile(rawOrPath)) {
                throw new FactsCatalogError(`facts catalog not found at ${rawOrPath}`);
            }
        } catch (e) {
            if (e instanceof FactsCatalogError) throw e;
            throw new FactsCatalogError(
                e instanceof Error ? e.message : `Cannot inspect facts catalog at ${rawOrPath}: ${String(e)}`,
            );
        }
        let text: string;
        try {
            text = fs.readFileSync(rawOrPath, 'utf-8');
        } catch (e) {
            throw new FactsCatalogError(
                `Cannot read facts catalog at ${rawOrPath}: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            throw new FactsCatalogError(
                `Invalid JSON in facts catalog at ${rawOrPath}: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
        return parseObject(parsed);
    }
    return parseObject(rawOrPath);
}
