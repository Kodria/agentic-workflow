import { isSingleLine } from './text-safety';

export const RECORD_SCHEMA = 'awm.change-record/v1';
export const PENDING_MARKER = '<!-- awm:pending -->';
export const RECORD_DIR = 'docs/changes';
export const MAX_RECORD_BYTES = 64 * 1024;
export const MAX_DIAGNOSTICS = 50;
export const BODY_HEADINGS = ['## Qué se hizo', '## Qué se probó', '## Qué falta validar', '## Riesgos y rollback'] as const;
export const DERIVED_KEYS = ['type', 'scope', 'semver', 'breaking', 'modules'] as const;

// The ONE definition of what a receipt (receipt.ts), a record's verification block (validate-shape.ts) and git (git.ts) may hold.
export const SENSOR_STATUSES = ['pass', 'fail', 'inconclusive', 'skipped'] as const;
export const OVERALLS = ['pass', 'fail', 'skipped', 'not_certified'] as const;
export type SensorStatus = (typeof SENSOR_STATUSES)[number];
export type Overall = (typeof OVERALLS)[number];
export const MAX_SENSOR_NAME = 128;
/** A full commit id: SHA-1 (40) or SHA-256 (64) lowercase hex characters. */
export const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export const isCommitId = (v: unknown): v is string => typeof v === 'string' && COMMIT_ID.test(v);
export const isOverall = (v: unknown): v is Overall => typeof v === 'string' && (OVERALLS as readonly string[]).includes(v);
export const isSensorStatus = (v: unknown): v is SensorStatus => typeof v === 'string' && (SENSOR_STATUSES as readonly string[]).includes(v);
/** A sensor name: one line, 1 to 128 code points. */
export const isSensorName = (v: unknown): v is string => isSingleLine(v) && [...v].length >= 1 && [...v].length <= MAX_SENSOR_NAME;
export type Semver = 'major' | 'minor' | 'patch' | 'none';

export interface Verification {
    commit: string;
    overall: Overall;
    sensors: Record<string, SensorStatus>;
    receipt_digest: string;
}

export interface DerivedFields {
    type: string;
    scope: string | null;
    semver: Semver;
    breaking: boolean;
    modules: string[];
}

export type ManualValidation = Array<{ step: string; expected: string }> | { none: string };

export interface ChangeRecord extends DerivedFields {
    schema: typeof RECORD_SCHEMA;
    id: string;
    title: string;
    summary_short: string;
    links?: { plan?: string; issue?: string };
    verification: Verification;
    manual_validation: ManualValidation;
    risks: string[];
    rollback: string;
    provenance?: { agent?: string; model?: string; session?: string; started_at?: string; finished_at?: string };
}

export interface Diagnostic { code: string; message: string; field?: string }
