# `inconclusive` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separar el estado "no aplica" del estado "no pude certificar" en los sensores, para que un sensor que no corrió deje de leerse como verde en el `overall`.

**Architecture:** Se agrega un cuarto valor `inconclusive` a `SensorResult.status`. Los productores de skip no benigno (timeout, ENOBUFS, exit no interpretable, sensor sin `cmd`) pasan a emitirlo; `enabled: false` se queda en `skipped`. La agregación suma una rama: cualquier `inconclusive` lleva `overall` a `not_certified`. El dominio de `overall` y el exit code no cambian, así que los consumidores externos (skills del registry, que leen `overall`) no se tocan.

**Tech Stack:** TypeScript, Jest (ts-jest), Node `child_process.execSync`.

**Modo de ejecución:** interactivo

**Spec:** `docs/plans/2026-07-27-sensor-inconclusive-state-design.md`

---

## File Structure

| Archivo | Responsabilidad | Acción |
|---|---|---|
| `cli/src/commands/sensors/types.ts` | Contrato de tipos del módulo. Es donde vive la definición de la frontera entre estados | Modificar: union de `status` + doc del enum |
| `cli/src/commands/sensors/run.ts` | Ejecución de sensores y agregación del veredicto | Modificar: `runSensor` (3 ramas), `runSensors` (rama sin `cmd` + agregación), `applyBaseline` (early-return) |
| `cli/tests/commands/sensors/run-inconclusive.test.ts` | Tests del estado nuevo y de la agregación. `execSync` mockeado — timeout y ENOBUFS no se provocan barato contra un shell real | Crear |
| `cli/tests/commands/sensors/index.test.ts` | Tests del mapeo a exit code | Modificar: sumar caso `not_certified` |
| `cli/tests/commands/sensors/run-tool-missing.test.ts` | Tests contra `/bin/sh` real (herramienta ausente) | No tocar — sirve de red de no-regresión |
| `awm-baseline-registry` → `skills/subagent-driven-development/implementer-prompt.md` | Instrucción de lectura del veredicto para el implementador | Modificar: 4 líneas |

**Nota de aislamiento (CLAUDE.md):** el archivo de tests nuevo sobreescribe `process.env.AWM_HOME` a un tmpdir. Ningún test puede tocar el `~/.awm` real.

---

### Task 1: Estado `inconclusive` + timeout + agregación (el ancla)

_Requirements: R1, R2, R7, R8_

**Files:**
- Modify: `cli/src/commands/sensors/types.ts:21-29`
- Modify: `cli/src/commands/sensors/run.ts:131-133` (rama timeout), `cli/src/commands/sensors/run.ts:217-221` (agregación)
- Test: `cli/tests/commands/sensors/run-inconclusive.test.ts`

Este es el escenario exacto del issue con el hueco que quedó abierto tras el fix de exit 127: un sensor sano al lado de uno que no corrió, y el `overall` diciendo `pass`.

- [ ] **Step 1: Write the failing test**

Crear `cli/tests/commands/sensors/run-inconclusive.test.ts`:

```typescript
import fs from 'fs';
import os from 'os';
import path from 'path';

const mockExecSyncFn = jest.fn();
jest.mock('child_process', () => ({
    execSync: (...args: any[]) => mockExecSyncFn(...args),
}));

/** Sensors run in manifest insertion order, so mocks are queued in that order. */
const MANIFEST = {
    pack: 'js-ts',
    sensors: {
        typecheck: { cmd: 'npx tsc --noEmit', fast: true },
        security: { cmd: 'semgrep .', fast: false },
    },
};

const timeoutError = () => { throw Object.assign(new Error('killed'), { code: 'ETIMEDOUT' }); };

describe('runSensors — inconclusive: a sensor that could not certify is never green', () => {
    let root: string;
    let fakeAwmHome: string;
    let prevAwmHome: string | undefined;

    beforeEach(() => {
        jest.resetModules();
        mockExecSyncFn.mockReset();
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-inconclusive-'));
        fs.mkdirSync(path.join(root, '.awm'), { recursive: true });
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), JSON.stringify(MANIFEST));
        // CLAUDE.md: no test may reach the real ~/.awm.
        fakeAwmHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-home-'));
        prevAwmHome = process.env.AWM_HOME;
        process.env.AWM_HOME = fakeAwmHome;
    });

    afterEach(() => {
        process.env.AWM_HOME = prevAwmHome;
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(fakeAwmHome, { recursive: true, force: true });
    });

    const load = () => require('../../../src/commands/sensors/run');

    it('reports a timed-out sensor as inconclusive, keeping its reason', () => {  // verifies R2, R7
        mockExecSyncFn
            .mockReturnValueOnce('' as any)          // typecheck: clean
            .mockImplementationOnce(timeoutError);   // security: times out

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        const security = out.sensors.find((s: any) => s.name === 'security');
        expect(security.status).toBe('inconclusive');
        expect(security.skipReason).toMatch(/timeout/);
    });

    it('does not let a healthy sensor carry the run to pass while another could not certify', () => {  // verifies R8
        mockExecSyncFn
            .mockReturnValueOnce('' as any)
            .mockImplementationOnce(timeoutError);

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        expect(out.sensors.find((s: any) => s.name === 'typecheck').status).toBe('pass');
        expect(out.overall).toBe('not_certified');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd cli && npx jest tests/commands/sensors/run-inconclusive.test.ts
```

Expected: FAIL en ambos. El primero: `Expected: "inconclusive" / Received: "skipped"`. El segundo: `Expected: "not_certified" / Received: "pass"` — el defecto reportado, reproducido.

- [ ] **Step 3: Add the state to the type**

En `cli/src/commands/sensors/types.ts`, reemplazar el campo `status` de `SensorResult`:

```typescript
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
```

- [ ] **Step 4: Emit `inconclusive` on timeout**

En `cli/src/commands/sensors/run.ts`, rama de timeout dentro de `runSensor`:

```typescript
        // Genuine timeout: execSync kills with SIGTERM after `timeout` ms. The
        // sensor produced no verdict — inconclusive, not a benign skip.
        if (err.code === 'ETIMEDOUT' || (err.killed && err.signal === 'SIGTERM')) {
            return { name, status: 'inconclusive', errors: [], skipReason: `timeout after ${timeout}ms` };
        }
```

- [ ] **Step 5: Add the aggregation branch**

En `cli/src/commands/sensors/run.ts`, dentro de `runSensors`:

```typescript
    // `fail` outranks `inconclusive`: when something is broken AND something
    // could not be measured, the broken thing is the actionable verdict.
    let overall: RunOutput['overall'] = results.some(r => r.status === 'fail') ? 'fail'
        : results.some(r => r.status === 'inconclusive') ? 'not_certified'
        : results.length > 0 && results.every(r => r.status === 'skipped') ? 'skipped'
        : results.length === 0 ? 'skipped'
        : 'pass';
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd cli && npx jest tests/commands/sensors/run-inconclusive.test.ts
```

Expected: PASS, 2/2.

- [ ] **Step 7: Commit**

```bash
git add cli/src/commands/sensors/types.ts cli/src/commands/sensors/run.ts cli/tests/commands/sensors/run-inconclusive.test.ts
git commit -m "feat(sensors): add inconclusive status so a sensor that could not certify is never green"
```

---

### Task 2: ENOBUFS → `inconclusive`

_Requirements: R3_

**Files:**
- Modify: `cli/src/commands/sensors/run.ts:127-129`
- Test: `cli/tests/commands/sensors/run-inconclusive.test.ts`

Salida truncada = no sabemos qué encontró el sensor. Es tan desconocido como un timeout.

- [ ] **Step 1: Write the failing test**

Agregar dentro del `describe` existente:

```typescript
    it('reports a sensor whose output was truncated as inconclusive', () => {  // verifies R3
        mockExecSyncFn
            .mockReturnValueOnce('' as any)
            .mockImplementationOnce(() => { throw Object.assign(new Error('too big'), { code: 'ENOBUFS' }); });

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        const security = out.sensors.find((s: any) => s.name === 'security');
        expect(security.status).toBe('inconclusive');
        expect(security.skipReason).toMatch(/exceeded/);
        expect(out.overall).toBe('not_certified');
    });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd cli && npx jest tests/commands/sensors/run-inconclusive.test.ts -t "truncated"
```

Expected: FAIL — `Expected: "inconclusive" / Received: "skipped"`.

- [ ] **Step 3: Write minimal implementation**

```typescript
        // Output exceeded maxBuffer — child is killed before output can be read.
        // Check this BEFORE the SIGTERM branch (ENOBUFS kills with SIGTERM too).
        // Nothing could be read, so nothing was certified.
        if (err.code === 'ENOBUFS') {
            return { name, status: 'inconclusive', errors: [], skipReason: `output exceeded ${MAX_BUFFER} bytes` };
        }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd cli && npx jest tests/commands/sensors/run-inconclusive.test.ts
```

Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/sensors/run.ts cli/tests/commands/sensors/run-inconclusive.test.ts
git commit -m "feat(sensors): truncated sensor output is inconclusive, not a benign skip"
```

---

### Task 3: Exit no interpretable → `inconclusive`

_Requirements: R4_

**Files:**
- Modify: `cli/src/commands/sensors/run.ts:178` (el `return` final de `runSensor`)
- Test: `cli/tests/commands/sensors/run-inconclusive.test.ts`

Es el caso residual: salió no-cero, la herramienta existe, no es sensor de exit-code, y el formatter no pudo sacar ni un hallazgo. No sabemos qué pasó.

- [ ] **Step 1: Write the failing test**

```typescript
    it('reports an uninterpretable non-zero exit as inconclusive', () => {  // verifies R4
        mockExecSyncFn
            .mockReturnValueOnce('' as any)
            .mockImplementationOnce(() => {
                // semgrep formatter yields no findings for non-JSON output, the
                // tool is present (exit 2, not 127), and `security` is not an
                // exit-code sensor — the residual "I don't know" case.
                throw Object.assign(new Error('failed'), {
                    stdout: '', stderr: 'internal error: rule engine crashed\n', status: 2,
                });
            });

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        const security = out.sensors.find((s: any) => s.name === 'security');
        expect(security.status).toBe('inconclusive');
        expect(security.skipReason).toMatch(/exit 2/);
        expect(out.overall).toBe('not_certified');
    });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd cli && npx jest tests/commands/sensors/run-inconclusive.test.ts -t "uninterpretable"
```

Expected: FAIL — `Expected: "inconclusive" / Received: "skipped"`.

- [ ] **Step 3: Write minimal implementation**

Reemplazar el `return` final de `runSensor`:

```typescript
        // Residual case: it exited non-zero, the tool exists, and no finding
        // could be parsed. We do not know what happened — say so instead of
        // reporting a benign skip.
        return { name, status: 'inconclusive', errors: [], skipReason: `exit ${err.status}: ${raw.slice(0, 200)}` };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd cli && npx jest tests/commands/sensors/run-inconclusive.test.ts
```

Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/sensors/run.ts cli/tests/commands/sensors/run-inconclusive.test.ts
git commit -m "feat(sensors): an uninterpretable sensor exit is inconclusive"
```

---

### Task 4: Sensor sin `cmd` → `inconclusive`

_Requirements: R5_

**Files:**
- Modify: `cli/src/commands/sensors/run.ts:206-209`
- Test: `cli/tests/commands/sensors/run-inconclusive.test.ts`

Un sensor declarado, habilitado y sin comando es una configuración rota. La forma deliberada de apagar un sensor es `enabled: false` — así lo hace `mutation` en `pack.json` del registry.

- [ ] **Step 1: Write the failing test**

```typescript
    it('reports an enabled sensor with no cmd as inconclusive', () => {  // verifies R5
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: {
                typecheck: { cmd: 'npx tsc --noEmit', fast: true },
                depcheck: { fast: false },   // enabled, but nothing to run
            },
        }));
        mockExecSyncFn.mockReturnValueOnce('' as any);   // typecheck: clean

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        const depcheck = out.sensors.find((s: any) => s.name === 'depcheck');
        expect(depcheck.status).toBe('inconclusive');
        expect(depcheck.skipReason).toBe('no cmd configured');
        expect(out.overall).toBe('not_certified');
    });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd cli && npx jest tests/commands/sensors/run-inconclusive.test.ts -t "no cmd"
```

Expected: FAIL — `Expected: "inconclusive" / Received: "skipped"`.

- [ ] **Step 3: Write minimal implementation**

En `runSensors`:

```typescript
        if (!config.cmd) {
            // Enabled but with nothing to run: broken config, not a deliberate
            // opt-out. `enabled: false` is how a sensor is turned off.
            results.push({ name, status: 'inconclusive', errors: [], skipReason: 'no cmd configured' });
            continue;
        }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd cli && npx jest tests/commands/sensors/run-inconclusive.test.ts
```

Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/sensors/run.ts cli/tests/commands/sensors/run-inconclusive.test.ts
git commit -m "feat(sensors): an enabled sensor with no cmd is inconclusive, not skipped"
```

---

### Task 5: Precedencia `fail` > `inconclusive`, y dominio de `overall`

_Requirements: R9, R11_

**Files:**
- Test: `cli/tests/commands/sensors/run-inconclusive.test.ts`

Sin cambio de código: fija el orden ya implementado en la Task 1 y el compromiso de compatibilidad (`overall` no gana valores nuevos), que es lo que hace seguro no tocar los skills del registry.

- [ ] **Step 1: Write the test**

```typescript
    it('reports fail, not not_certified, when something is broken and something could not run', () => {  // verifies R9
        mockExecSyncFn
            .mockImplementationOnce(() => {   // typecheck: real findings
                throw Object.assign(new Error(), {
                    stdout: 'src/a.ts(1,1): error TS0001: Bad type.', stderr: '', status: 1,
                });
            })
            .mockImplementationOnce(timeoutError);   // security: times out

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        expect(out.sensors.find((s: any) => s.name === 'typecheck').status).toBe('fail');
        expect(out.sensors.find((s: any) => s.name === 'security').status).toBe('inconclusive');
        expect(out.overall).toBe('fail');
    });

    it('never emits an overall value outside the published domain', () => {  // verifies R11
        // `inconclusive` is a per-sensor status only. External consumers (the
        // registry skills) read `overall`, whose domain must not grow.
        const DOMAIN = ['pass', 'fail', 'skipped', 'not_certified'];

        mockExecSyncFn
            .mockReturnValueOnce('' as any)
            .mockImplementationOnce(timeoutError);

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        expect(DOMAIN).toContain(out.overall);
        expect(out.overall).not.toBe('inconclusive');
    });
```

- [ ] **Step 2: Run the tests**

```bash
cd cli && npx jest tests/commands/sensors/run-inconclusive.test.ts
```

Expected: PASS, 7/7.

- [ ] **Step 3: Commit**

```bash
git add cli/tests/commands/sensors/run-inconclusive.test.ts
git commit -m "test(sensors): pin fail>inconclusive precedence and the overall domain"
```

---

### Task 6: `enabled: false` sigue siendo `skipped` benigno

_Requirements: R1, R6_

**Files:**
- Test: `cli/tests/commands/sensors/run-inconclusive.test.ts`

El test que prueba que la separación de R1 es real: los dos valores coexisten en una misma corrida y significan cosas distintas. Sin este test, nada impide que un refactor futuro colapse los dos estados de vuelta en uno.

- [ ] **Step 1: Write the test**

```typescript
    it('keeps a deliberately disabled sensor apart from one that could not certify', () => {  // verifies R1, R6
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: {
                typecheck: { cmd: 'npx tsc --noEmit', fast: true },
                security: { cmd: 'semgrep .', fast: false },
                mutation: { cmd: 'npx stryker run', enabled: false },
            },
        }));
        mockExecSyncFn
            .mockReturnValueOnce('' as any)          // typecheck: clean
            .mockImplementationOnce(timeoutError);   // security: times out
                                                     // mutation: never invoked

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        // Same run, two different meanings — the whole point of the split.
        expect(out.sensors.find((s: any) => s.name === 'mutation').status).toBe('skipped');
        expect(out.sensors.find((s: any) => s.name === 'mutation').skipReason).toBe('disabled');
        expect(out.sensors.find((s: any) => s.name === 'security').status).toBe('inconclusive');
    });

    it('does not degrade the verdict for a disabled sensor alongside healthy ones', () => {  // verifies R6
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: {
                typecheck: { cmd: 'npx tsc --noEmit', fast: true },
                mutation: { cmd: 'npx stryker run', enabled: false },
            },
        }));
        mockExecSyncFn.mockReturnValueOnce('' as any);

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        expect(out.overall).toBe('pass');
    });
```

- [ ] **Step 2: Run the tests**

```bash
cd cli && npx jest tests/commands/sensors/run-inconclusive.test.ts
```

Expected: PASS, 9/9.

- [ ] **Step 3: Commit**

```bash
git add cli/tests/commands/sensors/run-inconclusive.test.ts
git commit -m "test(sensors): pin that a disabled sensor stays a benign skip"
```

---

### Task 7: El honest floor sigue intacto

_Requirements: R10_

**Files:**
- Test: `cli/tests/commands/sensors/run-inconclusive.test.ts`

Verifica que la rama nueva no cortocircuitó el piso que ya existía: todos los sensores apagados sobre un árbol con stack real sigue siendo `not_certified` — un proyecto no puede certificarse apagando todo.

- [ ] **Step 1: Write the test**

```typescript
    it('still refuses to certify a tree whose sensors are all disabled', () => {  // verifies R10
        fs.writeFileSync(path.join(root, '.awm', 'sensors.json'), JSON.stringify({
            pack: 'js-ts',
            sensors: {
                typecheck: { cmd: 'npx tsc --noEmit', enabled: false },
                security: { cmd: 'semgrep .', enabled: false },
            },
        }));
        fs.writeFileSync(path.join(root, 'package.json'), '{}');   // real stack indicator

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        expect(out.sensors.every((s: any) => s.status === 'skipped')).toBe(true);
        expect(out.overall).toBe('not_certified');
        expect(mockExecSyncFn).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run the test**

```bash
cd cli && npx jest tests/commands/sensors/run-inconclusive.test.ts -t "all disabled"
```

Expected: PASS (el honest floor no se tocó; este test es red de no-regresión).

- [ ] **Step 3: Commit**

```bash
git add cli/tests/commands/sensors/run-inconclusive.test.ts
git commit -m "test(sensors): pin the honest floor against the new aggregation branch"
```

---

### Task 8: No-regresión — herramienta ausente y exit code

_Requirements: R12, R13_

**Files:**
- Verify (no editar): `cli/tests/commands/sensors/run-tool-missing.test.ts`, `cli/tests/commands/sensors/index.test.ts:12-19`

Las dos decisiones tomadas en el diseño, ancladas en tests: la herramienta ausente NO se muda al estado nuevo, y `not_certified` NO cambia de exit code.

**Esta tarea no escribe tests nuevos** — los que hacen falta ya existen. Escribir duplicados sería scope creep. Lo que la tarea hace es correrlos como red de no-regresión y dejar constancia de que cubren R12 y R13.

- [ ] **Step 1: Run the real-shell suite unchanged**

```bash
cd cli && npx jest tests/commands/sensors/run-tool-missing.test.ts
```

Expected: PASS, 3/3 — sin editar el archivo. Si alguno cae, la herramienta ausente se mudó a `inconclusive` por accidente y viola R12.

- [ ] **Step 2: Run the existing exit-code suite**

`cli/tests/commands/sensors/index.test.ts:12-19` ya cubre el mapeo completo, incluida la línea que fija la decisión:

```typescript
    it('not_certified → 0 (signal is in overall, not exit code)', () =>
        expect(exitCodeFor(base('not_certified'))).toBe(0));
    it('fail → 1', () => expect(exitCodeFor(base('fail'))).toBe(1));
```

```bash
cd cli && npx jest tests/commands/sensors/index.test.ts
```

Expected: PASS, 4/4. Cae solo si alguien tocó `exitCodeFor`, que este plan no toca.

- [ ] **Step 3: Run the whole suite**

```bash
cd cli && npm test
```

Expected: PASS en todos los suites (961 tests preexistentes + los 11 agregados por este plan). Cualquier caída acá es una regresión de este cambio.

- [ ] **Step 4: Build**

```bash
cd cli && npm run build
```

Expected: `tsc` sin errores. Es el chequeo que prueba que ningún consumidor del tipo `SensorResult` quedó sin manejar el valor nuevo.

- [ ] **Step 5: Nothing to commit**

Esta tarea es de verificación. Si no hubo cambios, no hay commit.

---

### Task 9: `applyBaseline` no toca resultados sin veredicto

_Requirements: R14_

**Files:**
- Modify: `cli/src/commands/sensors/run.ts:37`
- Test: `cli/tests/commands/sensors/run-inconclusive.test.ts`

Un sensor sin veredicto no tiene hallazgos que ratchetear. Sin esto, `partition` corre sobre una lista vacía y puede reescribir el `status` a `pass` — devolviendo el falso verde por la puerta de atrás.

- [ ] **Step 1: Write the failing test**

```typescript
    it('leaves an inconclusive result untouched when a baseline is applied', () => {  // verifies R14
        const { writeBaseline } = require('../../../src/commands/sensors/baseline');
        writeBaseline(root, { security: ['some-accepted-fingerprint'] });

        mockExecSyncFn
            .mockReturnValueOnce('' as any)
            .mockImplementationOnce(timeoutError);

        const { runSensors } = load();
        const out = runSensors({ cwd: root });

        const security = out.sensors.find((s: any) => s.name === 'security');
        expect(security.status).toBe('inconclusive');
        expect(security.baselineCount).toBeUndefined();
        expect(out.overall).toBe('not_certified');
    });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd cli && npx jest tests/commands/sensors/run-inconclusive.test.ts -t "baseline"
```

Expected: FAIL. Con el early-return solo sobre `'skipped'`, el resultado `inconclusive` entra a `applyBaseline`.

- [ ] **Step 3: Write minimal implementation**

En `cli/src/commands/sensors/run.ts`:

```typescript
/**
 * Apply the baseline to a sensor result: keep only findings not already accepted.
 * `status` becomes 'pass' when every finding was baseline-suppressed. Results
 * without a verdict of their own — skipped and inconclusive — are returned
 * untouched: there is nothing to ratchet, and letting them through here would
 * hand back a `pass` for a sensor that never reported anything.
 */
function applyBaseline(result: SensorResult, accepted: string[] | undefined): SensorResult {
    if (result.status === 'skipped' || result.status === 'inconclusive') return result;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd cli && npx jest tests/commands/sensors/run-inconclusive.test.ts
```

Expected: PASS, 11/11.

- [ ] **Step 5: Commit**

```bash
git add cli/src/commands/sensors/run.ts cli/tests/commands/sensors/run-inconclusive.test.ts
git commit -m "fix(sensors): keep the baseline away from results with no verdict"
```

---

### Task 10: Actualizar la instrucción de lectura del veredicto en el registry

_Requirements: R15_

**Files:**
- Modify: `awm-baseline-registry` → `skills/subagent-driven-development/implementer-prompt.md:71-73`

Repo distinto, misma rama (`claude/agentic-workflow-issue-1a31ru`). El texto actual explica `not_certified` como si solo pudiera venir de un `.awm/sensors.json` ausente; ahora tiene dos causas y el implementador necesita poder distinguirlas al reportar.

- [ ] **Step 1: Read the current text**

```bash
cd ~/awm-baseline-registry && sed -n 69,76p skills/subagent-driven-development/implementer-prompt.md
```

- [ ] **Step 2: Replace the paragraph**

Reemplazar exactamente:

```
       **Lee `overall`, no el exit code.** `not_certified` (sin `.awm/sensors.json`)
       also exits 0 — do NOT report it as "sensors pass". If the verdict is
       `not_certified`, state it explicitly: "no sensors configured, gate not certified".
       Only `overall: "pass"` counts as green; `fail` must be fixed before reporting DONE.
```

por:

```
       **Lee `overall`, no el exit code.** `not_certified` also exits 0 — do NOT
       report it as "sensors pass". It has two causes, and they are reported
       differently: (a) there is no `.awm/sensors.json` — "no sensors configured,
       gate not certified"; (b) a sensor could not certify (`status:
       "inconclusive"` — timeout, truncated output, uninterpretable exit, no cmd)
       — name it: "sensor <name> inconclusive: <skipReason>, gate not certified".
       Only `overall: "pass"` counts as green; `fail` must be fixed before reporting DONE.
```

- [ ] **Step 3: Verify the edit landed**

```bash
cd ~/awm-baseline-registry && grep -n "inconclusive" skills/subagent-driven-development/implementer-prompt.md
```

Expected: dos líneas con `inconclusive`, dentro del párrafo del paso 4 del prompt.

- [ ] **Step 4: Commit and push (registry repo)**

```bash
cd ~/awm-baseline-registry
git add skills/subagent-driven-development/implementer-prompt.md
git commit -m "docs: not_certified now also means a sensor could not certify"
git push -u origin claude/agentic-workflow-issue-1a31ru
```

---

## Self-Review

### Traceability matrix

| Req | Task(s) | Test(s) |
|------|---------|---------|
| R1 | T1, T6 | `keeps a deliberately disabled sensor apart from one that could not certify` — un mismo run devuelve `skipped` e `inconclusive` con significados distintos |
| R2 | T1 | `reports a timed-out sensor as inconclusive, keeping its reason` |
| R3 | T2 | `reports a sensor whose output was truncated as inconclusive` |
| R4 | T3 | `reports an uninterpretable non-zero exit as inconclusive` |
| R5 | T4 | `reports an enabled sensor with no cmd as inconclusive` |
| R6 | T6 | `does not degrade the verdict for a disabled sensor alongside healthy ones` |
| R7 | T1 | `reports a timed-out sensor as inconclusive, keeping its reason` (assert sobre `skipReason`) |
| R8 | T1 | `does not let a healthy sensor carry the run to pass while another could not certify` |
| R9 | T5 | `reports fail, not not_certified, when something is broken and something could not run` |
| R10 | T7 | `still refuses to certify a tree whose sensors are all disabled` |
| R11 | T5 | `never emits an overall value outside the published domain` |
| R12 | T8 | `run-tool-missing.test.ts` completo, sin editar (3 tests contra `/bin/sh` real) |
| R13 | T8 | `index.test.ts:16-18` — `not_certified → 0`, `fail → 1` (preexistentes, se corren como no-regresión) |
| R14 | T9 | `leaves an inconclusive result untouched when a baseline is applied` |
| R15 | T10 | `grep -n "inconclusive" implementer-prompt.md` — verificación por lectura, no automatizada |

**Forward gaps:** ninguno — los 15 requirements tienen tarea y test.
**Backward gaps:** ninguno — todas las tareas y tests trazan a un ID.

**Precisión de la matriz.** Dos filas dependen de una verificación más débil que el resto y conviene decirlo en vez de disimularlo:

- **R15** se verifica con un `grep` sobre una palabra que este mismo plan introduce en el archivo. Prueba que el texto entró, no que quedó bien redactado — esa parte es lectura manual en la review.
- **R1** es una afirmación estructural ("cuatro estados, cada uno con un significado"). No hay un assert que pruebe la ausencia de colapso futuro; lo más cercano es el test de T6, que exige los dos valores en desacuerdo dentro de una misma corrida. Es un proxy fuerte, no una prueba de la propiedad.

### Placeholder scan

Sin `TBD`/`TODO`, sin "add appropriate error handling", sin "similar to Task N". Cada step que cambia código muestra el código completo.

### Type consistency

`SensorResult.status` se define en T1 con los cuatro valores y todas las tareas posteriores usan exactamente `'inconclusive'` y `'skipped'`. `skipReason` conserva su nombre (no se renombra a algo tipo `reason` pese a que ahora también explica inconclusive) — renombrarlo rompería consumidores por cero beneficio.

### UI task propagation

No aplica: no hay tareas de UI en este plan.

### Analyze gate

- Cada requirement tiene ≥1 tarea y ≥1 test. ✅
- Ninguna tarea ni test queda sin ID de requirement. ✅

Gate sin gaps.
