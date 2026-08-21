/**
 * Kept structural so the legacy runtime contract does not import the v2
 * compatibility layer. `compatibility/types`.StructuredCommand is assignable to
 * this shape at the preparation boundary.
 */
export type PreparedStructuredCommand = {
    executable: string;
    resolution: 'node-modules-bin' | 'python-environment' | 'path';
    pythonEnvironmentRoot?: '.venv' | 'venv';
    args: string[];
    packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun';
    environment?: { ESLINT_USE_FLAT_CONFIG: 'true' | 'false' };
    fileInput?: { placeholder: '{files}'; extensions: string[] };
};

export type PreparedSensorExecution = {
    name: string;
    command?: { kind: 'legacy'; value: string } | { kind: 'structured'; value: PreparedStructuredCommand };
    formatter?: string;
    timeoutMs: number;
    timeoutSource: 'project' | 'pack' | 'fallback';
    requestedScope: 'full' | 'changed';
    effectiveScope: 'full' | 'changed';
    scopeReason?: string;
    files?: number;
    syntheticStatus?: 'pass' | 'skipped' | 'inconclusive';
    syntheticReason?: string;
};

export type SensorConfig = {
    cmd?: string;
    fast?: boolean;
    enabled?: boolean;
    timeout?: number;
    /**
     * Opt-in scoped variant used by `awm sensors run --changed`, with `{files}`
     * standing in for the changed file list (e.g. `eslint --format json {files}`).
     *
     * Opt-in, never inferred. Scoping is sound only where a finding is a property of
     * the file it lives in — eslint, semgrep. A whole-program checker (`tsc`) handed a
     * subset reports clean while the change breaks a caller it was never shown, which
     * is a false green. A sensor that omits this key keeps running its full `cmd`
     * under `--changed`: slower, but never wrong.
     */
    changedCmd?: string;
    /**
     * Extensions this sensor can actually be handed, e.g. `[".ts", ".tsx"]`. The
     * changed set is every file the tree touched — a README, a lockfile, a PNG — and
     * eslint given a `.md` does not skip it, it fails. Filtering is per sensor because
     * the same diff means different things to eslint and to semgrep. When the filter
     * empties the list, the sensor is skipped rather than run over the whole repo.
     * Absent → the sensor accepts whatever changed.
     */
    changedExtensions?: string[];
    /**
     * Which output-shape parser to use for this sensor's raw output (e.g. `tsc`,
     * `eslint-llm`, `mypy`, `ruff`, `shellcheck`, `semgrep`, `test`, `generic`) —
     * sourced from the pack's `pack.json`, since the tool behind a sensor slot varies
     * by pack (`lint` is eslint on js-ts, ruff on python, shellcheck on shell). Absent
     * on manifests written before this field existed, in which case dispatch falls back
     * to the sensor NAME (`typecheck`/`lint`/`security`/`test`/generic).
     */
    formatter?: string;
};

export type SensorManifest = {
    pack: string;
    sensors: Record<string, SensorConfig>;
    /** How many sensors may run at once. Defaults to a core-count-derived cap. */
    concurrency?: number;
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
    /**
     * The run was cut short (timeout, output cap) but the partial output still
     * yielded findings. The findings listed are real; their *absence* proves
     * nothing, so this can never accompany a `pass`. Holds the reason, so the
     * caller can tell "clean" from "clean as far as we got".
     */
    incomplete?: string;
    /**
     * Set to 'changed' when this sensor ran against the diff rather than the whole
     * tree. Makes a scoped result self-describing: a `pass` here means "clean over
     * the changed files", which is a weaker claim than an unscoped `pass`, and the
     * reader must be able to tell them apart without knowing which flags were used.
     */
    scope?: 'changed';
    /** New findings (not in baseline). Present only when a baseline is applied. */
    newCount?: number;
    /** Findings suppressed by the baseline. Present only when a baseline is applied. */
    baselineCount?: number;
};

export type RunOutput = {
    sensors: SensorResult[];
    overall: 'pass' | 'fail' | 'skipped' | 'not_certified';
    /**
     * Set when the committed manifest still sits on the `generic` fallback while the
     * tree has real stack indicators — the gate ran, but against almost nothing.
     * Advisory and non-mutating by design: `awm sensors run` reports the drift and
     * runs the manifest as committed; adopting the real pack is `awm sensors init`.
     */
    packDrift?: { manifest: string; detected: string; remedy: string };
    /**
     * Present only on a `--changed` run. `files` is how many changed files were in
     * scope; `error` explains why the scope could not be resolved, in which case every
     * sensor fell back to its full command. Emitted so a scoped run is never read as a
     * full one just because it happened to come back green.
     */
    changedScope?: { files: number; error?: string };
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
