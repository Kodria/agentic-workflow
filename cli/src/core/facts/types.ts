/** First CLI version that understands registry facts / needs. Bump only with intentional release. */
export const FACTS_MIN_CLI_VERSION = '9.18.0';

/** Dotted fact ids: `repos.root`, `aws.profile.dev`. */
export const FACT_ID_RE = /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/;

export type FactValueType = 'string' | 'path' | 'enum';
export type FactResolution = 'prompt';
export type FactDurability = 'durable' | 'volatile';
export type FactInject = 'reference' | 'context';

export interface FactDefinition {
    description?: string;
    valueType: FactValueType;
    resolution: FactResolution;
    durability: FactDurability;
    inject: FactInject;
    values?: string[];
    ttl?: number;
}

export interface FactsCatalog {
    schemaVersion: 1;
    facts: Record<string, FactDefinition>;
}

export class FactsCatalogError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FactsCatalogError';
    }
}

export class SkillNeedsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SkillNeedsError';
    }
}
