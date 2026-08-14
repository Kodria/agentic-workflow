export type CompatibilityState =
    | 'certified'
    | 'compatible-unverified'
    | 'incompatible'
    | 'missing-tool'
    | 'unverifiable'
    | 'not-applicable';

export type StructuredCommand = {
    executable: string;
    resolution: 'node-modules-bin' | 'python-environment' | 'path';
    args: string[];
    fileInput?: { placeholder: '{files}'; extensions: string[] };
};

export type CompatibilityEvidence = {
    state: CompatibilityState;
    reason: string;
    variantId: string | null;
    toolVersion: string | null;
    runtimeVersion: string | null;
    certifiedRange: string | null;
    evidence: Array<{ kind: string; status: string; path?: string }>;
};

export type CompatibilityProbe =
    | 'version'
    | 'eslint-print-config'
    | 'typescript-show-config'
    | 'semgrep-validate'
    | 'package-script-present'
    | 'config-present';

export type SensorVariant = {
    id: string;
    priority: number;
    certifiedRange: string;
    requirements: { tool: string; toolRange: string; runtime: string; runtimeRange: string; configFiles?: string[] };
    assets: string[];
    formatter: string;
    probe: { kind: CompatibilityProbe };
    command: StructuredCommand;
};

/**
 * Stricter pack configuration that is deliberately inert until an explicit opt-in
 * surface selects it. That future surface must require a named hardening choice and
 * package-manager/environment resolution before it can materialize any asset.
 */
export type SensorPackHardening = Record<string, { assets: string[] }>;

export type SensorPackSensor = {
    applicability: { allFiles?: string[]; anyFiles?: string[]; kind?: string };
    variants: SensorVariant[];
    fast?: boolean;
};

export type SensorPackV2 = {
    schemaVersion: 2;
    name: string;
    description: string;
    detects: string[];
    sensors: Record<string, SensorPackSensor>;
    coverage: unknown;
    hardening?: SensorPackHardening;
};

export type LegacySensorPack = {
    name: string;
    description?: string;
    detects?: string[];
    sensors: Record<string, { defaultCmd?: string; fast?: boolean; enabled?: boolean; changedCmd?: string; changedExtensions?: string[]; formatter?: string; configFile?: string; configFileFallback?: string }>;
    coverage?: unknown;
    compatibility: CompatibilityEvidence;
};

export type SensorPack = SensorPackV2 | LegacySensorPack;
export type ParsedSensorPack = { kind: 'v2'; pack: SensorPackV2 } | { kind: 'legacy'; pack: LegacySensorPack };
