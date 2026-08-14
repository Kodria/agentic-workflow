import type { CoverageContract } from '../coverage/contract';

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
    probes: CompatibilityProbe[];
    command: StructuredCommand;
};

export type SensorPackSensor = {
    variants: SensorVariant[];
};

export type SensorPackV2 = {
    schemaVersion: 2;
    id: string;
    assets: string[];
    sensors: Record<string, SensorPackSensor>;
    coverage: CoverageContract;
};

export type LegacySensorPack = {
    name: string;
    description?: string;
    detects?: unknown[];
    sensors: Record<string, unknown>;
    coverage?: CoverageContract;
    compatibility: CompatibilityEvidence;
};

export type SensorPack = SensorPackV2 | LegacySensorPack;
