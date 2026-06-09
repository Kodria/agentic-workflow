# Harness Engineering — Plan 1: Core Sensor Loop
<!-- awm-plan-closed: 2026-06-09 — ejecutado; cierre administrativo retroactivo, verificado contra historial de git (previo a la existencia del marcador awm-qa-complete) -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `awm sensors run/init/status/install`, sensor packs js-ts + generic, and the PostToolUse hook — the complete computational feedback loop.

**Architecture:** AWM CLI discovers what sensors exist in the target repo (`.awm/sensors.json`), runs them with timeout protection, converts raw output to LLM-friendly JSON via per-tool formatters, and wires the fast path into a PostToolUse hook. All new code follows the pattern in `cli/src/commands/hooks/`.

**Tech Stack:** TypeScript, Node.js, Commander, @clack/prompts, picocolors, Jest + ts-jest. All tests run with `npm test` from `cli/`.

---

## File Map

**Create:**
- `cli/src/commands/sensors/types.ts` — shared TypeScript interfaces
- `cli/src/commands/sensors/formatters/tsc.ts` — tsc output parser
- `cli/src/commands/sensors/formatters/eslint.ts` — ESLint JSON parser
- `cli/src/commands/sensors/formatters/semgrep.ts` — Semgrep JSON parser
- `cli/src/commands/sensors/formatters/generic.ts` — raw output fallback
- `cli/src/commands/sensors/run.ts` — sensor runner (reads manifest, executes, formats)
- `cli/src/commands/sensors/init.ts` — stack detection + manifest writer
- `cli/src/commands/sensors/status.ts` — sensor health check
- `cli/src/commands/sensors/install.ts` — PostToolUse hook install/uninstall
- `cli/src/commands/sensors/index.ts` — CLI router
- `cli/tests/commands/sensors/formatters/tsc.test.ts`
- `cli/tests/commands/sensors/formatters/eslint.test.ts`
- `cli/tests/commands/sensors/formatters/semgrep.test.ts`
- `cli/tests/commands/sensors/run.test.ts`
- `cli/tests/commands/sensors/init.test.ts`
- `cli/tests/commands/sensors/status.test.ts`
- `cli/tests/commands/sensors/install.test.ts`
- `cli/tests/commands/sensors/router.test.ts`
- `registry/sensor-packs/js-ts/pack.json`
- `registry/sensor-packs/js-ts/eslint.config.awm.mjs`
- `registry/sensor-packs/js-ts/eslint.config.awm.cjs`
- `registry/sensor-packs/js-ts/tsconfig.awm.json`
- `registry/sensor-packs/js-ts/.dep-cruiser.awm.js`
- `registry/sensor-packs/js-ts/.semgrep.awm.yml`
- `registry/sensor-packs/generic/pack.json`
- `registry/sensor-packs/generic/.semgrep.awm.yml`
- `cli/tests/registry/sensor-packs.test.ts`

**Modify:**
- `cli/src/index.ts` — add `registerSensorsCommand(program)` (line ~542, after `registerHooksCommand`)

---

## Task 1: Shared Types

**Files:**
- Create: `cli/src/commands/sensors/types.ts`

No test needed — pure TypeScript types.

- [ ] **Step 1: Create types file**

```typescript
// cli/src/commands/sensors/types.ts

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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd cli && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add cli/src/commands/sensors/types.ts
git commit -m "feat(sensors): add shared TypeScript types"
```

---

## Task 2: tsc Formatter

**Files:**
- Create: `cli/src/commands/sensors/formatters/tsc.ts`
- Test: `cli/tests/commands/sensors/formatters/tsc.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// cli/tests/commands/sensors/formatters/tsc.test.ts
import { parseTscOutput } from '../../../../src/commands/sensors/formatters/tsc';

describe('parseTscOutput', () => {
    it('parses a standard tsc error line', () => {
        const raw = "src/auth.ts(23,7): error TS2322: Type 'string | undefined' is not assignable to type 'string'.";
        const errors = parseTscOutput(raw);
        expect(errors).toHaveLength(1);
        expect(errors[0].file).toBe('src/auth.ts');
        expect(errors[0].line).toBe(23);
        expect(errors[0].rule).toBe('TS2322');
        expect(errors[0].message).toMatch('SENSOR[typecheck]');
        expect(errors[0].message).toMatch('Fix:');
    });

    it('returns empty array for clean output', () => {
        expect(parseTscOutput('')).toEqual([]);
        expect(parseTscOutput('Found 0 errors.')).toEqual([]);
    });

    it('ignores malformed lines, parses valid ones', () => {
        const raw = 'some random text\nsrc/file.ts(1,1): error TS0000: Real error.';
        const errors = parseTscOutput(raw);
        expect(errors).toHaveLength(1);
        expect(errors[0].file).toBe('src/file.ts');
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd cli && npm test -- --testPathPattern="formatters/tsc" --no-coverage
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement**

```typescript
// cli/src/commands/sensors/formatters/tsc.ts
import { SensorError } from '../types';

const TSC_LINE = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.+)$/;

export function parseTscOutput(raw: string): SensorError[] {
    return raw
        .split('\n')
        .filter(Boolean)
        .map(line => {
            const m = TSC_LINE.exec(line);
            if (!m) return null;
            const [, file, lineStr, , code, msg] = m;
            return {
                file,
                line: parseInt(lineStr, 10),
                rule: code,
                message: `SENSOR[typecheck] ${file} line ${lineStr} — ${msg} Fix: review the type annotation. Error code: ${code}.`,
            } satisfies SensorError;
        })
        .filter((e): e is SensorError => e !== null);
}
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd cli && npm test -- --testPathPattern="formatters/tsc" --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/sensors/formatters/tsc.ts cli/tests/commands/sensors/formatters/tsc.test.ts
git commit -m "feat(sensors): add tsc LLM-friendly formatter"
```

---

## Task 3: ESLint Formatter

**Files:**
- Create: `cli/src/commands/sensors/formatters/eslint.ts`
- Test: `cli/tests/commands/sensors/formatters/eslint.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// cli/tests/commands/sensors/formatters/eslint.test.ts
import { parseEslintOutput } from '../../../../src/commands/sensors/formatters/eslint';

const SAMPLE = JSON.stringify([
    {
        filePath: '/home/user/project/src/index.ts',
        messages: [
            { ruleId: 'no-unused-vars', severity: 2, message: "'x' is assigned a value but never used.", line: 42, column: 5 },
            { ruleId: 'no-console', severity: 1, message: 'Unexpected console statement.', line: 10, column: 1 }
        ]
    }
]);

describe('parseEslintOutput', () => {
    let cwdSpy: jest.SpyInstance;
    beforeEach(() => { cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue('/home/user/project'); });
    afterEach(() => { cwdSpy.mockRestore(); });

    it('parses ESLint JSON and filters severity-1 warnings', () => {
        const errors = parseEslintOutput(SAMPLE);
        expect(errors).toHaveLength(1);
        expect(errors[0].rule).toBe('no-unused-vars');
        expect(errors[0].line).toBe(42);
        expect(errors[0].message).toMatch('SENSOR[lint]');
        expect(errors[0].message).toMatch('Fix:');
    });

    it('returns empty array for malformed JSON', () => {
        expect(parseEslintOutput('not json')).toEqual([]);
    });

    it('returns empty array when all messages are warnings', () => {
        const warnings = JSON.stringify([{ filePath: '/p/f.ts', messages: [{ ruleId: 'r', severity: 1, message: 'w', line: 1, column: 1 }] }]);
        expect(parseEslintOutput(warnings)).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd cli && npm test -- --testPathPattern="formatters/eslint" --no-coverage
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement**

```typescript
// cli/src/commands/sensors/formatters/eslint.ts
import { SensorError } from '../types';

type EslintMessage = { ruleId: string | null; severity: number; message: string; line: number; column: number; };
type EslintFile = { filePath: string; messages: EslintMessage[]; };

export function parseEslintOutput(raw: string): SensorError[] {
    let parsed: EslintFile[];
    try { parsed = JSON.parse(raw); } catch { return []; }
    const errors: SensorError[] = [];
    const cwd = process.cwd();
    for (const file of parsed) {
        for (const msg of file.messages) {
            if (msg.severity < 2) continue;
            const rel = file.filePath.startsWith(cwd + '/') ? file.filePath.slice(cwd.length + 1) : file.filePath;
            errors.push({
                file: rel,
                line: msg.line,
                column: msg.column,
                rule: msg.ruleId ?? 'unknown',
                message: `SENSOR[lint] ${rel}:${msg.line} — ${msg.message} Fix: check rule ${msg.ruleId ?? 'unknown'}.`,
            });
        }
    }
    return errors;
}
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd cli && npm test -- --testPathPattern="formatters/eslint" --no-coverage
```

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/sensors/formatters/eslint.ts cli/tests/commands/sensors/formatters/eslint.test.ts
git commit -m "feat(sensors): add ESLint LLM-friendly formatter"
```

---

## Task 4: Semgrep + Generic Formatters

**Files:**
- Create: `cli/src/commands/sensors/formatters/semgrep.ts`
- Create: `cli/src/commands/sensors/formatters/generic.ts`
- Test: `cli/tests/commands/sensors/formatters/semgrep.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// cli/tests/commands/sensors/formatters/semgrep.test.ts
import { parseSemgrepOutput } from '../../../../src/commands/sensors/formatters/semgrep';
import { parseGenericOutput } from '../../../../src/commands/sensors/formatters/generic';

const SAMPLE_SEMGREP = JSON.stringify({
    results: [
        { check_id: 'js.sql-injection', path: 'src/db.ts', start: { line: 15 }, extra: { message: 'SQL injection risk detected.' } }
    ]
});

describe('parseSemgrepOutput', () => {
    it('parses Semgrep JSON results', () => {
        const errors = parseSemgrepOutput(SAMPLE_SEMGREP);
        expect(errors).toHaveLength(1);
        expect(errors[0].file).toBe('src/db.ts');
        expect(errors[0].line).toBe(15);
        expect(errors[0].rule).toBe('js.sql-injection');
        expect(errors[0].message).toMatch('SENSOR[security]');
        expect(errors[0].message).toMatch('Fix:');
    });

    it('returns empty array for malformed JSON', () => {
        expect(parseSemgrepOutput('bad json')).toEqual([]);
    });

    it('returns empty array when results is empty', () => {
        expect(parseSemgrepOutput(JSON.stringify({ results: [] }))).toEqual([]);
    });
});

describe('parseGenericOutput', () => {
    it('wraps raw output with SENSOR[raw] prefix', () => {
        const errors = parseGenericOutput('something went wrong');
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toMatch('SENSOR[raw]');
        expect(errors[0].message).toMatch('something went wrong');
    });

    it('returns empty array for empty output', () => {
        expect(parseGenericOutput('')).toEqual([]);
        expect(parseGenericOutput('   ')).toEqual([]);
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd cli && npm test -- --testPathPattern="formatters/semgrep" --no-coverage
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement semgrep formatter**

```typescript
// cli/src/commands/sensors/formatters/semgrep.ts
import { SensorError } from '../types';

type SemgrepResult = { check_id: string; path: string; start: { line: number }; extra: { message: string }; };
type SemgrepOutput = { results: SemgrepResult[]; };

export function parseSemgrepOutput(raw: string): SensorError[] {
    let parsed: SemgrepOutput;
    try { parsed = JSON.parse(raw); } catch { return []; }
    return (parsed.results ?? []).map(r => ({
        file: r.path,
        line: r.start.line,
        rule: r.check_id,
        message: `SENSOR[security] ${r.path}:${r.start.line} — ${r.extra.message} Fix: review rule ${r.check_id}.`,
    }));
}
```

- [ ] **Step 4: Implement generic formatter**

```typescript
// cli/src/commands/sensors/formatters/generic.ts
import { SensorError } from '../types';

export function parseGenericOutput(raw: string): SensorError[] {
    if (!raw.trim()) return [];
    return [{ message: `SENSOR[raw] ${raw.trim()}` }];
}
```

- [ ] **Step 5: Run test — verify PASS**

```bash
cd cli && npm test -- --testPathPattern="formatters/semgrep" --no-coverage
```

Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add cli/src/commands/sensors/formatters/semgrep.ts cli/src/commands/sensors/formatters/generic.ts cli/tests/commands/sensors/formatters/semgrep.test.ts
git commit -m "feat(sensors): add semgrep and generic formatters"
```

---

## Task 5: Sensor Runner (`run.ts`)

**Files:**
- Create: `cli/src/commands/sensors/run.ts`
- Test: `cli/tests/commands/sensors/run.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// cli/tests/commands/sensors/run.test.ts
import { execSync } from 'child_process';
import fs from 'fs';

jest.mock('child_process', () => ({ execSync: jest.fn() }));

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

const MANIFEST = {
    pack: 'js-ts',
    sensors: {
        typecheck: { cmd: 'npx tsc --noEmit', fast: true },
        lint:      { cmd: 'npx eslint . --format json', fast: true },
        security:  { cmd: 'semgrep .', fast: false, enabled: false },
        mutation:  { enabled: false }
    }
};

describe('runSensors', () => {
    let tmpDir: string;
    const path = require('path');
    const os = require('os');

    beforeEach(() => {
        jest.resetModules();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-run-test-'));
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify(MANIFEST));
        mockExecSync.mockReset();
    });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    const load = () => require('../../../../src/commands/sensors/run');

    it('returns skipped output when manifest does not exist', () => {
        const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-empty-'));
        try {
            const { runSensors } = load();
            const result = runSensors({ fast: true, cwd: emptyDir });
            expect(result.overall).toBe('skipped');
            expect(result.sensors).toHaveLength(0);
        } finally { fs.rmSync(emptyDir, { recursive: true }); }
    });

    it('runs only fast sensors with --fast flag', () => {
        mockExecSync.mockReturnValue('' as any);
        const { runSensors } = load();
        const result = runSensors({ fast: true, cwd: tmpDir });
        expect(mockExecSync).toHaveBeenCalledTimes(2); // typecheck + lint (security disabled, mutation disabled)
        expect(result.sensors.some(s => s.name === 'security')).toBe(false);
        expect(result.overall).toBe('pass');
    });

    it('returns fail when a fast sensor has errors', () => {
        mockExecSync
            .mockImplementationOnce(() => { throw Object.assign(new Error(), { stdout: "src/a.ts(1,1): error TS0001: Bad type.", stderr: '', status: 1 }); })
            .mockReturnValueOnce('' as any);
        const { runSensors } = load();
        const result = runSensors({ fast: true, cwd: tmpDir });
        expect(result.overall).toBe('fail');
        const tc = result.sensors.find((s: any) => s.name === 'typecheck');
        expect(tc!.status).toBe('fail');
        expect(tc!.errors[0].message).toMatch('SENSOR[typecheck]');
    });

    it('marks sensor as skipped on timeout', () => {
        mockExecSync.mockImplementationOnce(() => { throw Object.assign(new Error('killed'), { code: 'ETIMEDOUT' }); });
        mockExecSync.mockReturnValueOnce('' as any);
        const { runSensors } = load();
        const result = runSensors({ fast: true, cwd: tmpDir });
        const tc = result.sensors.find((s: any) => s.name === 'typecheck');
        expect(tc!.status).toBe('skipped');
        expect(tc!.skipReason).toMatch('timeout');
    });

    it('skips disabled sensors', () => {
        mockExecSync.mockReturnValue('' as any);
        const { runSensors } = load();
        const result = runSensors({ all: true, cwd: tmpDir });
        const sec = result.sensors.find((s: any) => s.name === 'security');
        expect(sec!.status).toBe('skipped');
        expect(sec!.skipReason).toBe('disabled');
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd cli && npm test -- --testPathPattern="sensors/run" --no-coverage
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement**

```typescript
// cli/src/commands/sensors/run.ts
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { SensorManifest, SensorResult, RunOutput, SensorError } from './types';
import { parseTscOutput } from './formatters/tsc';
import { parseEslintOutput } from './formatters/eslint';
import { parseSemgrepOutput } from './formatters/semgrep';
import { parseGenericOutput } from './formatters/generic';

const MANIFEST_FILE = '.awm/sensors.json';
const DEFAULT_FAST_TIMEOUT = 10_000;
const DEFAULT_SLOW_TIMEOUT = 120_000;

export type RunOptions = {
    fast?: boolean;
    slow?: boolean;
    all?: boolean;
    cwd?: string;
};

function readManifest(cwd: string): SensorManifest | null {
    const p = path.join(cwd, MANIFEST_FILE);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function shouldRun(isFast: boolean, opts: RunOptions): boolean {
    if (opts.all) return true;
    if (opts.fast && isFast) return true;
    if (opts.slow && !isFast) return true;
    if (!opts.fast && !opts.slow && !opts.all) return true;
    return false;
}

function getFormatter(name: string): (raw: string) => SensorError[] {
    if (name === 'typecheck') return parseTscOutput;
    if (name === 'lint') return parseEslintOutput;
    if (name === 'security') return parseSemgrepOutput;
    return parseGenericOutput;
}

function runSensor(name: string, cmd: string, timeout: number): SensorResult {
    try {
        const raw = execSync(cmd, { encoding: 'utf-8', timeout, stdio: ['pipe', 'pipe', 'pipe'] });
        const errors = getFormatter(name)(raw);
        return { name, status: errors.length > 0 ? 'fail' : 'pass', errors };
    } catch (err: any) {
        if (err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM') {
            return { name, status: 'skipped', errors: [], skipReason: `timeout after ${timeout}ms` };
        }
        const raw = String((err.stdout ?? '') + (err.stderr ?? ''));
        const errors = getFormatter(name)(raw);
        if (errors.length > 0) return { name, status: 'fail', errors };
        return { name, status: 'skipped', errors: [], skipReason: `exit ${err.status}: ${raw.slice(0, 200)}` };
    }
}

export function runSensors(opts: RunOptions = {}): RunOutput {
    const cwd = opts.cwd ?? process.cwd();
    const manifest = readManifest(cwd);
    if (!manifest) return { sensors: [], overall: 'skipped' };

    const results: SensorResult[] = [];

    for (const [name, config] of Object.entries(manifest.sensors)) {
        if (config.enabled === false) {
            results.push({ name, status: 'skipped', errors: [], skipReason: 'disabled' });
            continue;
        }
        if (!config.cmd) {
            results.push({ name, status: 'skipped', errors: [], skipReason: 'no cmd configured' });
            continue;
        }
        const isFast = config.fast ?? false;
        if (!shouldRun(isFast, opts)) continue;

        const timeout = config.timeout ?? (isFast ? DEFAULT_FAST_TIMEOUT : DEFAULT_SLOW_TIMEOUT);
        results.push(runSensor(name, config.cmd, timeout));
    }

    const overall = results.some(r => r.status === 'fail') ? 'fail'
        : results.length > 0 && results.every(r => r.status === 'skipped') ? 'skipped'
        : results.length === 0 ? 'skipped'
        : 'pass';

    return { sensors: results, overall };
}
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd cli && npm test -- --testPathPattern="sensors/run" --no-coverage
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/sensors/run.ts cli/tests/commands/sensors/run.test.ts
git commit -m "feat(sensors): implement sensor runner with LLM-friendly output"
```

---

## Task 6: Stack Detection + Manifest Init (`init.ts`)

**Files:**
- Create: `cli/src/commands/sensors/init.ts`
- Test: `cli/tests/commands/sensors/init.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// cli/tests/commands/sensors/init.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { detectStack, buildManifest, initSensors } from '../../../../src/commands/sensors/init';

describe('detectStack', () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-')); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    it('detects js-ts when package.json exists', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        expect(detectStack(tmpDir).pack).toBe('js-ts');
    });

    it('detects python when pyproject.toml exists', () => {
        fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '');
        expect(detectStack(tmpDir).pack).toBe('python');
    });

    it('falls back to generic when no indicators found', () => {
        expect(detectStack(tmpDir).pack).toBe('generic');
    });
});

describe('buildManifest', () => {
    it('builds manifest with pack defaults for js-ts', () => {
        const m = buildManifest('js-ts');
        expect(m.pack).toBe('js-ts');
        expect(m.sensors.typecheck).toBeDefined();
        expect(m.sensors.lint).toBeDefined();
    });

    it('merges conservatively — existing sensor commands are preserved', () => {
        const existing = { pack: 'js-ts', sensors: { typecheck: { cmd: 'custom-tsc', fast: true } } };
        const m = buildManifest('js-ts', existing);
        expect(m.sensors.typecheck.cmd).toBe('custom-tsc');
        expect(m.sensors.lint).toBeDefined();
    });

    it('uses generic defaults when pack is unknown', () => {
        const m = buildManifest('generic');
        expect(m.sensors.security).toBeDefined();
    });
});

describe('initSensors', () => {
    let tmpDir: string;
    beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-init-')); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    it('creates .awm/sensors.json for js-ts project', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        const result = initSensors({ cwd: tmpDir });
        expect(fs.existsSync(path.join(tmpDir, '.awm', 'sensors.json'))).toBe(true);
        expect(result.detection.pack).toBe('js-ts');
        expect(result.manifest.sensors.typecheck).toBeDefined();
    });

    it('is idempotent — existing sensor commands survive re-init', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        const existing = { pack: 'js-ts', sensors: { typecheck: { cmd: 'my-tsc', fast: true } } };
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify(existing));
        initSensors({ cwd: tmpDir });
        const written = JSON.parse(fs.readFileSync(path.join(tmpDir, '.awm', 'sensors.json'), 'utf-8'));
        expect(written.sensors.typecheck.cmd).toBe('my-tsc');
        expect(written.sensors.lint).toBeDefined(); // new sensor added
    });

    it('copies pack config files to repo with --configure', () => {
        fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
        const registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-reg-'));
        try {
            const packDir = path.join(registryRoot, 'sensor-packs', 'js-ts');
            fs.mkdirSync(packDir, { recursive: true });
            fs.writeFileSync(path.join(packDir, 'tsconfig.awm.json'), '{}');
            const result = initSensors({ cwd: tmpDir, configure: true, registryRoot });
            expect(result.configured).toContain('tsconfig.awm.json');
            expect(fs.existsSync(path.join(tmpDir, 'tsconfig.awm.json'))).toBe(true);
        } finally { fs.rmSync(registryRoot, { recursive: true }); }
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd cli && npm test -- --testPathPattern="sensors/init" --no-coverage
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement**

```typescript
// cli/src/commands/sensors/init.ts
import fs from 'fs';
import path from 'path';
import { SensorManifest } from './types';

export type InitOptions = {
    configure?: boolean;
    cwd?: string;
    registryRoot?: string;
};

export type StackDetection = {
    pack: 'js-ts' | 'python' | 'generic';
    indicators: string[];
};

const STACK_DETECTORS: Array<{ pack: StackDetection['pack']; files: string[] }> = [
    { pack: 'js-ts', files: ['package.json'] },
    { pack: 'python', files: ['pyproject.toml', 'setup.py', 'setup.cfg'] },
];

export function detectStack(cwd: string): StackDetection {
    for (const { pack, files } of STACK_DETECTORS) {
        const found = files.filter(f => fs.existsSync(path.join(cwd, f)));
        if (found.length > 0) return { pack, indicators: found };
    }
    return { pack: 'generic', indicators: [] };
}

const PACK_DEFAULTS: Record<string, SensorManifest['sensors']> = {
    'js-ts': {
        typecheck: { cmd: 'npx tsc --noEmit', fast: true },
        lint:      { cmd: 'npx eslint . --format json', fast: true },
        security:  { cmd: 'semgrep --config .semgrep.awm.yml --json .', fast: false },
        depcheck:  { cmd: 'npx depcruise --config .dep-cruiser.awm.js src', fast: false },
        mutation:  { enabled: false },
    },
    python: {
        typecheck: { cmd: 'mypy .', fast: true },
        lint:      { cmd: 'ruff check . --output-format json', fast: true },
        security:  { cmd: 'semgrep --config .semgrep.awm.yml --json .', fast: false },
        mutation:  { enabled: false },
    },
    generic: {
        security: { cmd: 'semgrep --config .semgrep.awm.yml --json .', fast: false },
    },
};

export function buildManifest(pack: string, existing?: SensorManifest): SensorManifest {
    const defaults = PACK_DEFAULTS[pack] ?? {};
    const existingSensors = existing?.sensors ?? {};
    return { pack, sensors: { ...defaults, ...existingSensors } };
}

export function initSensors(opts: InitOptions = {}): { manifest: SensorManifest; detection: StackDetection; configured: string[] } {
    const cwd = opts.cwd ?? process.cwd();
    const manifestPath = path.join(cwd, '.awm', 'sensors.json');
    const detection = detectStack(cwd);

    let existing: SensorManifest | undefined;
    if (fs.existsSync(manifestPath)) {
        try { existing = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch { /* ignore corrupt manifest */ }
    }

    const manifest = buildManifest(detection.pack, existing);
    fs.mkdirSync(path.join(cwd, '.awm'), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    const configured: string[] = [];
    if (opts.configure && opts.registryRoot) {
        const packDir = path.join(opts.registryRoot, 'sensor-packs', detection.pack);
        if (fs.existsSync(packDir)) {
            for (const file of fs.readdirSync(packDir).filter(f => f !== 'pack.json')) {
                const dst = path.join(cwd, file);
                if (!fs.existsSync(dst)) {
                    fs.copyFileSync(path.join(packDir, file), dst);
                    configured.push(file);
                }
            }
        }
    }

    return { manifest, detection, configured };
}
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd cli && npm test -- --testPathPattern="sensors/init" --no-coverage
```

Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/sensors/init.ts cli/tests/commands/sensors/init.test.ts
git commit -m "feat(sensors): add stack detection and manifest init"
```

---

## Task 7: Sensor Status (`status.ts`)

**Files:**
- Create: `cli/src/commands/sensors/status.ts`
- Test: `cli/tests/commands/sensors/status.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// cli/tests/commands/sensors/status.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { computeSensorStatus } from '../../../../src/commands/sensors/status';

jest.mock('child_process', () => ({ execSync: jest.fn() }));
const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;

describe('computeSensorStatus', () => {
    let tmpDir: string;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-status-'));
        mockExecSync.mockReset();
    });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    it('returns NOT_CONFIGURED when .awm/sensors.json missing', () => {
        const result = computeSensorStatus(tmpDir);
        expect(result.overall).toBe('NOT_CONFIGURED');
        expect(result.pack).toBeNull();
    });

    it('returns HEALTHY when all sensor binaries are found', () => {
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { typecheck: { cmd: 'npx tsc --noEmit', fast: true } }
        }));
        mockExecSync.mockReturnValue('' as any);
        const result = computeSensorStatus(tmpDir);
        expect(result.overall).toBe('HEALTHY');
        expect(result.pack).toBe('js-ts');
        expect(result.checks.typecheck.ok).toBe(true);
    });

    it('returns DEGRADED when a binary is missing', () => {
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { security: { cmd: 'semgrep --json .', fast: false } }
        }));
        mockExecSync.mockImplementation(() => { throw new Error('not found'); });
        const result = computeSensorStatus(tmpDir);
        expect(result.overall).toBe('DEGRADED');
        expect(result.checks.security.ok).toBe(false);
    });

    it('marks disabled sensors as ok', () => {
        fs.mkdirSync(path.join(tmpDir, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: { mutation: { enabled: false } }
        }));
        const result = computeSensorStatus(tmpDir);
        expect(result.checks.mutation.ok).toBe(true);
        expect(result.checks.mutation.detail).toBe('disabled');
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd cli && npm test -- --testPathPattern="sensors/status" --no-coverage
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement**

```typescript
// cli/src/commands/sensors/status.ts
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { SensorCheck, SensorStatusResult, SensorManifest } from './types';

function checkBinary(cmd: string): SensorCheck {
    const bin = cmd.split(' ')[0];
    const probe = cmd.startsWith('npx ') ? `which npx` : `which ${bin}`;
    try {
        execSync(probe, { stdio: 'pipe' });
        return { ok: true, detail: cmd.startsWith('npx ') ? `${bin} (via npx)` : bin };
    } catch {
        return { ok: false, detail: `${bin} not found in PATH` };
    }
}

export function computeSensorStatus(cwd: string = process.cwd()): SensorStatusResult {
    const manifestPath = path.join(cwd, '.awm', 'sensors.json');
    if (!fs.existsSync(manifestPath)) {
        return { overall: 'NOT_CONFIGURED', pack: null, checks: {} };
    }

    let manifest: SensorManifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch {
        return { overall: 'NOT_CONFIGURED', pack: null, checks: {} };
    }

    const checks: Record<string, SensorCheck> = {};
    for (const [name, config] of Object.entries(manifest.sensors)) {
        if (config.enabled === false) { checks[name] = { ok: true, detail: 'disabled' }; continue; }
        if (!config.cmd) { checks[name] = { ok: false, detail: 'no cmd configured' }; continue; }
        checks[name] = checkBinary(config.cmd);
    }

    const allOk = Object.values(checks).every(c => c.ok);
    return { overall: allOk ? 'HEALTHY' : 'DEGRADED', pack: manifest.pack, checks };
}
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd cli && npm test -- --testPathPattern="sensors/status" --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/sensors/status.ts cli/tests/commands/sensors/status.test.ts
git commit -m "feat(sensors): add sensor status health check"
```

---

## Task 8: PostToolUse Hook Install (`install.ts`)

**Files:**
- Create: `cli/src/commands/sensors/install.ts`
- Test: `cli/tests/commands/sensors/install.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// cli/tests/commands/sensors/install.test.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('sensor hook install/uninstall', () => {
    let tmpDir: string;
    let settingsPath: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-install-'));
        settingsPath = path.join(tmpDir, 'settings.json');
        jest.resetModules();
    });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true }); });

    const load = () => require('../../../../src/commands/sensors/install');

    it('installs PostToolUse hook into fresh settings.json', () => {
        const { installSensorHook } = load();
        const result = installSensorHook(settingsPath);
        expect(result.status).toBe('installed');
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        expect(settings.hooks.PostToolUse).toHaveLength(1);
        expect(settings.hooks.PostToolUse[0].matcher).toBe('Write|Edit|MultiEdit');
        expect(settings.hooks.PostToolUse[0].hooks[0].command).toBe('awm sensors run --fast');
    });

    it('merges with existing hooks — SessionStart entries preserved', () => {
        const existing = { hooks: { SessionStart: [{ matcher: 'startup', hooks: [] }] } };
        fs.writeFileSync(settingsPath, JSON.stringify(existing));
        const { installSensorHook } = load();
        installSensorHook(settingsPath);
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        expect(settings.hooks.SessionStart).toHaveLength(1);
        expect(settings.hooks.PostToolUse).toHaveLength(1);
    });

    it('is idempotent — second install returns already-installed', () => {
        const { installSensorHook } = load();
        installSensorHook(settingsPath);
        const result2 = installSensorHook(settingsPath);
        expect(result2.status).toBe('already-installed');
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        expect(settings.hooks.PostToolUse).toHaveLength(1);
    });

    it('creates a backup before modifying settings.json', () => {
        fs.writeFileSync(settingsPath, JSON.stringify({ hooks: {} }));
        const { installSensorHook } = load();
        const result = installSensorHook(settingsPath);
        expect(result.backupPath).toBeDefined();
        expect(fs.existsSync(result.backupPath!)).toBe(true);
    });

    it('uninstall removes only the AWM sensor PostToolUse entry', () => {
        const { installSensorHook, uninstallSensorHook } = load();
        installSensorHook(settingsPath);
        const result = uninstallSensorHook(settingsPath);
        expect(result.status).toBe('removed');
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        expect(settings.hooks?.PostToolUse ?? []).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd cli && npm test -- --testPathPattern="sensors/install" --no-coverage
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement**

```typescript
// cli/src/commands/sensors/install.ts
import fs from 'fs';
import path from 'path';
import os from 'os';

const POST_TOOL_USE_EVENT = 'PostToolUse';
const POST_TOOL_USE_MATCHER = 'Write|Edit|MultiEdit';
const AWM_SENSOR_CMD = 'awm sensors run --fast';

type HookEntry = { type: 'command'; command: string; };
type HookMatcher = { matcher: string; hooks: HookEntry[]; };

function defaultSettingsPath(): string {
    return path.join(process.env.HOME ?? os.homedir(), '.claude', 'settings.json');
}

function readSettings(p: string): any {
    if (!fs.existsSync(p)) return {};
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; }
}

function isAwmEntry(e: HookMatcher): boolean {
    return e.matcher === POST_TOOL_USE_MATCHER &&
        (e.hooks ?? []).some(h => h.command === AWM_SENSOR_CMD);
}

function backupSettings(settingsPath: string): string | undefined {
    if (!fs.existsSync(settingsPath)) return undefined;
    const awmHome = process.env.AWM_HOME || path.join(process.env.HOME ?? os.homedir(), '.awm');
    const backupDir = path.join(awmHome, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '-').slice(0, 19);
    const backupPath = path.join(backupDir, `settings.json.${ts}.sensor.bak`);
    fs.copyFileSync(settingsPath, backupPath);
    return backupPath;
}

export function installSensorHook(settingsPath: string = defaultSettingsPath()): { status: 'installed' | 'already-installed'; backupPath?: string } {
    const settings = readSettings(settingsPath);
    const entries: HookMatcher[] = settings?.hooks?.[POST_TOOL_USE_EVENT] ?? [];

    if (entries.some(isAwmEntry)) return { status: 'already-installed' };

    const backupPath = backupSettings(settingsPath);
    const newEntry: HookMatcher = {
        matcher: POST_TOOL_USE_MATCHER,
        hooks: [{ type: 'command', command: AWM_SENSOR_CMD }],
    };
    const updated = {
        ...settings,
        hooks: {
            ...(settings.hooks ?? {}),
            [POST_TOOL_USE_EVENT]: [...entries, newEntry],
        },
    };

    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2), 'utf-8');
    return { status: 'installed', backupPath };
}

export function uninstallSensorHook(settingsPath: string = defaultSettingsPath()): { status: 'removed' | 'not-found' } {
    if (!fs.existsSync(settingsPath)) return { status: 'not-found' };
    const settings = readSettings(settingsPath);
    const entries: HookMatcher[] = settings?.hooks?.[POST_TOOL_USE_EVENT] ?? [];
    const filtered = entries.filter(e => !isAwmEntry(e));
    if (filtered.length === entries.length) return { status: 'not-found' };

    const updated = { ...settings, hooks: { ...(settings.hooks ?? {}), [POST_TOOL_USE_EVENT]: filtered } };
    if (updated.hooks[POST_TOOL_USE_EVENT].length === 0) delete updated.hooks[POST_TOOL_USE_EVENT];
    if (Object.keys(updated.hooks).length === 0) delete updated.hooks;

    fs.writeFileSync(settingsPath, JSON.stringify(updated, null, 2), 'utf-8');
    return { status: 'removed' };
}
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd cli && npm test -- --testPathPattern="sensors/install" --no-coverage
```

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/sensors/install.ts cli/tests/commands/sensors/install.test.ts
git commit -m "feat(sensors): add PostToolUse hook install/uninstall"
```

---

## Task 9: CLI Router + Wire into Main Index

**Files:**
- Create: `cli/src/commands/sensors/index.ts`
- Test: `cli/tests/commands/sensors/router.test.ts`
- Modify: `cli/src/index.ts` (line 542 — after `registerHooksCommand(program)`)

- [ ] **Step 1: Write failing router test**

```typescript
// cli/tests/commands/sensors/router.test.ts
jest.mock('@clack/prompts', () => ({ log: { success: jest.fn(), info: jest.fn() } }));
jest.mock('picocolors', () => ({ green: (s: string) => s, yellow: (s: string) => s, red: (s: string) => s }));
jest.mock('../../../../src/commands/sensors/run', () => ({ runSensors: jest.fn().mockReturnValue({ sensors: [], overall: 'pass' }) }));
jest.mock('../../../../src/commands/sensors/init', () => ({ initSensors: jest.fn().mockReturnValue({ detection: { pack: 'js-ts', indicators: [] }, manifest: { sensors: {} }, configured: [] }) }));
jest.mock('../../../../src/commands/sensors/status', () => ({ computeSensorStatus: jest.fn().mockReturnValue({ overall: 'HEALTHY', pack: 'js-ts', checks: {} }) }));
jest.mock('../../../../src/commands/sensors/install', () => ({ installSensorHook: jest.fn().mockReturnValue({ status: 'installed' }) }));

import { Command } from 'commander';
import { registerSensorsCommand } from '../../../../src/commands/sensors/index';

describe('registerSensorsCommand', () => {
    it('registers sensors command with 4 subcommands', () => {
        const program = new Command();
        registerSensorsCommand(program);
        const cmd = program.commands.find(c => c.name() === 'sensors');
        expect(cmd).toBeDefined();
        const subNames = cmd!.commands.map(c => c.name());
        expect(subNames).toContain('run');
        expect(subNames).toContain('init');
        expect(subNames).toContain('status');
        expect(subNames).toContain('install');
    });
});
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd cli && npm test -- --testPathPattern="sensors/router" --no-coverage
```

Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement router**

```typescript
// cli/src/commands/sensors/index.ts
import { Command } from 'commander';
import path from 'path';
import os from 'os';
import pc from 'picocolors';
import { log } from '@clack/prompts';
import { runSensors } from './run';
import { initSensors } from './init';
import { computeSensorStatus } from './status';
import { installSensorHook } from './install';

const DEFAULT_REGISTRY_ROOT = path.join(os.homedir(), '.awm', 'cli-source');

export function registerSensorsCommand(program: Command): void {
    const sensors = program.command('sensors').description('manage computational sensors for the current project');

    sensors
        .command('run')
        .description('run sensors from .awm/sensors.json')
        .option('--fast', 'run fast sensors only (tsc, lint)')
        .option('--slow', 'run slow sensors only (semgrep, mutation)')
        .option('--all', 'run all sensors regardless of speed')
        .action((opts) => {
            const output = runSensors({ fast: opts.fast, slow: opts.slow, all: opts.all });
            process.stdout.write(JSON.stringify(output, null, 2) + '\n');
            if (output.overall === 'fail') process.exit(1);
        });

    sensors
        .command('init')
        .description('detect stack and write .awm/sensors.json')
        .option('--configure', 'also copy sensor pack config files into the project')
        .option('--registry-root <path>', 'path to AWM registry root', DEFAULT_REGISTRY_ROOT)
        .action((opts) => {
            const result = initSensors({ configure: opts.configure, registryRoot: opts.registryRoot });
            log.success(`Detected: ${result.detection.pack} (${result.detection.indicators.join(', ') || 'fallback'})`);
            log.success('Wrote .awm/sensors.json');
            result.configured.forEach((f: string) => log.info(`  Installed ${f}`));
        });

    sensors
        .command('status')
        .description('check sensor health for the current project')
        .action(() => {
            const status = computeSensorStatus();
            const icon = status.overall === 'HEALTHY' ? pc.green('✔') : pc.yellow('⚠');
            console.log(`\nPack:    ${status.pack ?? 'none'}`);
            console.log(`Overall: ${icon} ${status.overall}\n`);
            for (const [name, check] of Object.entries(status.checks)) {
                const mark = check.ok ? pc.green('✔') : pc.red('✘');
                console.log(`  ${mark}  ${name.padEnd(12)} ${check.detail}`);
            }
            console.log('');
            if (status.overall !== 'HEALTHY') process.exit(1);
        });

    sensors
        .command('install')
        .description('install PostToolUse hook in ~/.claude/settings.json')
        .action(() => {
            const result = installSensorHook();
            if (result.status === 'already-installed') {
                log.info('PostToolUse hook already installed.');
            } else {
                log.success('PostToolUse hook installed in ~/.claude/settings.json');
                if (result.backupPath) log.info(`  Backup: ${result.backupPath}`);
            }
        });
}
```

- [ ] **Step 4: Run test — verify PASS**

```bash
cd cli && npm test -- --testPathPattern="sensors/router" --no-coverage
```

Expected: PASS (1 test)

- [ ] **Step 5: Wire into main index.ts**

In `cli/src/index.ts`, add after line 16 (`import { registerHooksCommand } from './commands/hooks';`):

```typescript
import { registerSensorsCommand } from './commands/sensors';
```

And after line 542 (`registerHooksCommand(program);`):

```typescript
registerSensorsCommand(program);
```

- [ ] **Step 6: Verify it compiles and `awm sensors --help` works**

```bash
cd cli && npx tsc --noEmit && node dist/index.js sensors --help
```

If `dist/` doesn't exist yet, build first:
```bash
cd cli && npm run build && node dist/index.js sensors --help
```

Expected output includes: `run`, `init`, `status`, `install` subcommands.

- [ ] **Step 7: Run full test suite — verify no regressions**

```bash
cd cli && npm test --no-coverage
```

Expected: all tests pass (existing 91 + new sensor tests)

- [ ] **Step 8: Commit**

```bash
git add cli/src/commands/sensors/index.ts cli/tests/commands/sensors/router.test.ts cli/src/index.ts
git commit -m "feat(sensors): register awm sensors command router"
```

---

## Task 10: Sensor Pack Files (Registry)

**Files:**
- Create: `registry/sensor-packs/js-ts/pack.json`
- Create: `registry/sensor-packs/js-ts/eslint.config.awm.mjs`
- Create: `registry/sensor-packs/js-ts/eslint.config.awm.cjs`
- Create: `registry/sensor-packs/js-ts/tsconfig.awm.json`
- Create: `registry/sensor-packs/js-ts/.dep-cruiser.awm.js`
- Create: `registry/sensor-packs/js-ts/.semgrep.awm.yml`
- Create: `registry/sensor-packs/generic/pack.json`
- Create: `registry/sensor-packs/generic/.semgrep.awm.yml`

No TDD — these are static config files. Write and verify they parse correctly.

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p registry/sensor-packs/js-ts registry/sensor-packs/generic
```

- [ ] **Step 2: Create js-ts/pack.json**

```json
{
  "name": "js-ts",
  "description": "JavaScript / TypeScript sensor pack",
  "detects": ["package.json"],
  "sensors": {
    "typecheck": {
      "fast": true,
      "defaultCmd": "npx tsc --noEmit",
      "formatter": "tsc"
    },
    "lint": {
      "fast": true,
      "defaultCmd": "npx eslint . --format json",
      "configFile": "eslint.config.awm.mjs",
      "configFileFallback": "eslint.config.awm.cjs",
      "formatter": "eslint-llm"
    },
    "security": {
      "fast": false,
      "defaultCmd": "semgrep --config .semgrep.awm.yml --json .",
      "configFile": ".semgrep.awm.yml",
      "formatter": "semgrep"
    },
    "depcheck": {
      "fast": false,
      "defaultCmd": "npx depcruise --config .dep-cruiser.awm.js src",
      "configFile": ".dep-cruiser.awm.js",
      "formatter": "generic"
    },
    "mutation": {
      "fast": false,
      "enabled": false,
      "defaultCmd": "npx stryker run",
      "formatter": "generic"
    }
  }
}
```

- [ ] **Step 3: Create js-ts/tsconfig.awm.json**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "exactOptionalPropertyTypes": true
  }
}
```

- [ ] **Step 4: Create js-ts/eslint.config.awm.mjs** (ESLint v9 flat config)

```js
// AWM ESLint config — extends project config with LLM-friendly messages
// Requires: eslint.config.mjs in the project root (ESLint v9)
// Usage: npx eslint . --config eslint.config.awm.mjs --format json

let projectConfig = [];
try {
  const mod = await import('./eslint.config.mjs');
  projectConfig = Array.isArray(mod.default) ? mod.default : [mod.default];
} catch {
  // no project config — run with AWM rules only
}

export default [
  ...projectConfig,
  {
    rules: {
      'no-unused-vars': ['error', { vars: 'all', args: 'after-used' }],
      'no-undef': 'error',
      'no-unreachable': 'error',
    },
  },
];
```

- [ ] **Step 5: Create js-ts/eslint.config.awm.cjs** (ESLint v8 fallback)

```js
// AWM ESLint config — ESLint v8 format (.eslintrc compatible)
// Extends project config with LLM-friendly strict rules
// Usage: npx eslint . --config eslint.config.awm.cjs --format json

module.exports = {
  extends: ['./.eslintrc.js'],
  rules: {
    'no-unused-vars': ['error', { vars: 'all', args: 'after-used' }],
    'no-undef': 'error',
    'no-unreachable': 'error',
  },
};
```

- [ ] **Step 6: Create js-ts/.dep-cruiser.awm.js**

```js
// AWM dependency-cruiser config — enforces architectural boundaries
// Usage: npx depcruise --config .dep-cruiser.awm.js src

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make code hard to understand and test.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Orphan modules are not reachable from the entry point.',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$'] },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    reporterOptions: { text: { highlightFocused: true } },
  },
};
```

- [ ] **Step 7: Create js-ts/.semgrep.awm.yml**

```yaml
# AWM Semgrep rules — security patterns for JavaScript/TypeScript
# Usage: semgrep --config .semgrep.awm.yml --json .

rules:
  - id: awm-no-eval
    patterns:
      - pattern: eval(...)
    message: >
      SENSOR[security] Avoid eval() — it executes arbitrary code and is a security risk.
      Fix: use JSON.parse() for JSON, or refactor to avoid dynamic code execution.
    languages: [javascript, typescript]
    severity: ERROR

  - id: awm-no-hardcoded-secrets
    patterns:
      - pattern: |
          const $VAR = "..."
      - metavariable-regex:
          metavariable: $VAR
          regex: (password|secret|api_key|apikey|token|passwd)
    message: >
      SENSOR[security] Potential hardcoded secret in variable '$VAR'.
      Fix: use environment variables or a secrets manager instead.
    languages: [javascript, typescript]
    severity: WARNING

  - id: awm-no-sql-concat
    patterns:
      - pattern: |
          $QUERY + $VAR
      - metavariable-regex:
          metavariable: $QUERY
          regex: (SELECT|INSERT|UPDATE|DELETE|DROP)
    message: >
      SENSOR[security] Possible SQL injection via string concatenation.
      Fix: use parameterized queries or a query builder.
    languages: [javascript, typescript]
    severity: ERROR
```

- [ ] **Step 8: Create generic/pack.json**

```json
{
  "name": "generic",
  "description": "Generic sensor pack — Semgrep only, works with any language",
  "detects": [],
  "sensors": {
    "security": {
      "fast": false,
      "defaultCmd": "semgrep --config .semgrep.awm.yml --json .",
      "configFile": ".semgrep.awm.yml",
      "formatter": "semgrep"
    }
  }
}
```

- [ ] **Step 9: Create generic/.semgrep.awm.yml**

```yaml
# AWM Semgrep rules — generic security patterns (any language)

rules:
  - id: awm-generic-no-hardcoded-secrets
    patterns:
      - pattern: |
          $VAR = "..."
      - metavariable-regex:
          metavariable: $VAR
          regex: (password|secret|api_key|apikey|token|passwd)
    message: >
      SENSOR[security] Potential hardcoded secret in '$VAR'.
      Fix: use environment variables or a secrets manager.
    languages: [generic]
    severity: WARNING
```

- [ ] **Step 10: Verify JSON files parse correctly**

```bash
node -e "require('./registry/sensor-packs/js-ts/pack.json'); console.log('js-ts pack.json OK')"
node -e "require('./registry/sensor-packs/generic/pack.json'); console.log('generic pack.json OK')"
node -e "require('./registry/sensor-packs/js-ts/tsconfig.awm.json'); console.log('tsconfig.awm.json OK')"
```

Expected: all three `OK` lines.

- [ ] **Step 11: Commit**

```bash
git add registry/sensor-packs/
git commit -m "feat(registry): add sensor packs js-ts and generic"
```

---

## Task 11: Registry Tests for Sensor Packs

**Files:**
- Test: `cli/tests/registry/sensor-packs.test.ts`

- [ ] **Step 1: Write test**

```typescript
// cli/tests/registry/sensor-packs.test.ts
import fs from 'fs';
import path from 'path';

const REGISTRY_ROOT = path.join(__dirname, '..', '..', '..', 'registry');
const PACKS_DIR = path.join(REGISTRY_ROOT, 'sensor-packs');

describe('sensor-packs registry', () => {
    it('sensor-packs directory exists in registry', () => {
        expect(fs.existsSync(PACKS_DIR)).toBe(true);
    });

    for (const packName of ['js-ts', 'generic']) {
        describe(`pack: ${packName}`, () => {
            const packDir = path.join(PACKS_DIR, packName);

            it('directory exists', () => {
                expect(fs.existsSync(packDir)).toBe(true);
            });

            it('has valid pack.json', () => {
                const packJson = path.join(packDir, 'pack.json');
                expect(fs.existsSync(packJson)).toBe(true);
                const parsed = JSON.parse(fs.readFileSync(packJson, 'utf-8'));
                expect(parsed.name).toBe(packName);
                expect(typeof parsed.description).toBe('string');
                expect(typeof parsed.sensors).toBe('object');
            });

            it('pack.json name matches directory name', () => {
                const parsed = JSON.parse(fs.readFileSync(path.join(packDir, 'pack.json'), 'utf-8'));
                expect(parsed.name).toBe(packName);
            });
        });
    }

    it('js-ts pack has required sensor config files', () => {
        const jstsDir = path.join(PACKS_DIR, 'js-ts');
        expect(fs.existsSync(path.join(jstsDir, 'tsconfig.awm.json'))).toBe(true);
        expect(fs.existsSync(path.join(jstsDir, 'eslint.config.awm.mjs'))).toBe(true);
        expect(fs.existsSync(path.join(jstsDir, '.semgrep.awm.yml'))).toBe(true);
    });

    it('tsconfig.awm.json extends ./tsconfig.json', () => {
        const tsconfig = JSON.parse(fs.readFileSync(path.join(PACKS_DIR, 'js-ts', 'tsconfig.awm.json'), 'utf-8'));
        expect(tsconfig.extends).toBe('./tsconfig.json');
        expect(tsconfig.compilerOptions?.strict).toBe(true);
    });
});
```

- [ ] **Step 2: Run test — verify PASS**

```bash
cd cli && npm test -- --testPathPattern="registry/sensor-packs" --no-coverage
```

Expected: PASS (all tests)

- [ ] **Step 3: Run full suite — verify no regressions**

```bash
cd cli && npm test --no-coverage
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add cli/tests/registry/sensor-packs.test.ts
git commit -m "test(registry): add sensor pack validation tests"
```

---

## Post-Implementation Checklist

- [ ] `awm sensors init` detects js-ts, python, and generic repos correctly
- [ ] `awm sensors run --fast` exits 0 on clean code, exit 1 on errors, exits 0 silently with no manifest
- [ ] `awm sensors status` shows HEALTHY / DEGRADED / NOT_CONFIGURED
- [ ] `awm sensors install` adds PostToolUse entry to `~/.claude/settings.json`
- [ ] Full test suite passes: `cd cli && npm test`
- [ ] No TypeScript errors: `cd cli && npx tsc --noEmit`

---

## Notes for Plan 2

This plan implements the core sensor feedback loop. Two plans follow:

**Plan 2** — Feedforward extension:
- Extend `registry/hooks/session-start` to inject `CONSTITUTION.md` when present in `$PWD`
- New skill `project-constitution` — generates `CONSTITUTION.md` from project context

**Plan 3** — Intelligent layer + steering loop:
- New skill `setup-sensors` — guided configuration with Context7 integration
- New skill `harness-retro` — converts recurring bugs into sensor rules/tests/skills
- Modify `verification-before-completion`, `systematic-debugging`, `code-quality-reviewer` to propose harness-retro
