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
    /**
     * The boundary is not "did it run?" but "do I know what happened?".
     *
     * `pass`         — ran, no findings.
     * `fail`         — a defined, attributable, actionable problem: findings in
     *                  the code, an absent binary (you know exactly what to
     *                  install), or an exit-code sensor that exited non-zero.
     * `inconclusive` — it was attempted and the outcome is unknown: timeout,
     *                  truncated output, uninterpretable exit code, no `cmd`
     *                  configured. Never green — it degrades `overall` to
     *                  `not_certified`, because the gate certified nothing.
     * `skipped`      — does not apply, by deliberate operator choice
     *                  (`enabled: false`). Informational: on its own it does
     *                  not degrade the verdict.
     *
     * Keeping these last two apart is the point: one value meaning both
     * "not applicable" and "broken" is how an absent check reads as a clean one
     * (CONSTITUTION.md, "Implementación").
     */
    status: 'pass' | 'fail' | 'inconclusive' | 'skipped';
    errors: SensorError[];
    skipReason?: string;
    /** New findings (not in baseline). Present only when a baseline is applied. */
    newCount?: number;
    /** Findings suppressed by the baseline. Present only when a baseline is applied. */
    baselineCount?: number;
};

export type RunOutput = {
    sensors: SensorResult[];
    overall: 'pass' | 'fail' | 'skipped' | 'not_certified';
    /** Set when reconcilePack upgraded the manifest off the `generic` fallback
     *  (e.g. "generic→js-ts"). Absent on no-op runs. */
    packUpgraded?: string;
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
