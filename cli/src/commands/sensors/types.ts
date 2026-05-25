export type SensorConfig = {
    cmd?: string;
    fast?: boolean;
    enabled?: boolean;
    timeout?: number;
};

export type SensorManifest = {
    pack: string;
    sensors: Record<string, SensorConfig>;
};

export type SensorError = {
    file?: string;
    line?: number;
    column?: number;
    message: string;
    rule?: string;
};

export type SensorResult = {
    name: string;
    status: 'pass' | 'fail' | 'skipped';
    errors: SensorError[];
    skipReason?: string;
};

export type RunOutput = {
    sensors: SensorResult[];
    overall: 'pass' | 'fail' | 'skipped';
};

export type SensorCheck = {
    ok: boolean;
    detail: string;
};

export type SensorStatusResult = {
    overall: 'HEALTHY' | 'DEGRADED' | 'NOT_CONFIGURED';
    pack: string | null;
    checks: Record<string, SensorCheck>;
};
