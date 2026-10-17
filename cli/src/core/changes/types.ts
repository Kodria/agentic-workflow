export const RECORD_SCHEMA = 'awm.change-record/v1';
export const PENDING_MARKER = '<!-- awm:pending -->';
export const RECORD_DIR = 'docs/changes';
export const MAX_RECORD_BYTES = 64 * 1024;
export const MAX_DIAGNOSTICS = 50;
export const BODY_HEADINGS = ['## Qué se hizo', '## Qué se probó', '## Qué falta validar', '## Riesgos y rollback'] as const;
export const DERIVED_KEYS = ['type', 'scope', 'semver', 'breaking', 'modules'] as const;

export type SensorStatus = 'pass' | 'fail' | 'inconclusive' | 'skipped';
export type Overall = 'pass' | 'fail' | 'skipped' | 'not_certified';
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
