# R2 Static Sensor Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar `awm sensors coverage` como diagnóstico estático, read-only y provider-neutral, y publicar contratos de cobertura v1 para los cuatro sensor-packs baseline.

**Architecture:** La CLI valida datos persistidos desde `unknown`, resuelve el pack exacto respetando el orden de registries, recoge evidencia local sin ejecutar comandos y entrega las observaciones a un evaluador puro. El registry conserva el conocimiento de clases, detectores y remedios bajo `pack.json.coverage`; su propio gate estructural y de mutaciones impide publicar contratos que el consumidor no pueda interpretar de forma segura.

**Tech Stack:** TypeScript 5.9 y Node.js >=22 en `cli/`, Commander 14, Jest 30 y tmpdirs aislados; JSON, ESM y `node:assert` en `awm-baseline-registry`; GitHub Actions para validación y auto-tag.

**Modo de ejecución:** interactivo

---

## Fuentes y límites

- Diseño aprobado: `docs/plans/2026-08-11-r2-static-sensor-coverage-design.md`, commit `1cbc7c8926680ae36510fc921c90b09182777f4f`.
- Brief fuente: `docs/plans/2026-07-30-sdd-cycle-optimization-brief.md`.
- Issue coordinador: `https://github.com/Kodria/agentic-workflow/issues/20`.
- Decisiones vigentes: D-013 (referencia propiedad del registry) y D-014 (diagnóstico read-only).
- Base CLI: `origin/main` en `d8381e83093ed146de7c6e2a1a4b351b6c4fdf8c`.
- Base registry: `origin/main` en `ad61e5051cbb3f0b1a60e6ce10ca9f8f1fde75a9` (`v1.15.1`). La rama local del registry está atrasada; al comenzar su trabajo se crea una rama desde `origin/main`, sin reescribir `main` local.
- R2 termina en cobertura estática. No ejecuta sensores, no configura remedios, no lee el ledger y no implementa `empirical`; R3 añadirá esa sección opcional sobre el envelope estable de R2.
- Los templates copiados por AWM se evaluaron contra el stack real antes del handoff: `cli/.dep-cruiser.awm.js` se conserva y versiona porque respalda el sensor `depcheck`; `cli/eslint.config.awm.cjs` se excluye por ser incompatible con ESLint 10 y `cli/tsconfig.awm.json` se excluye porque no está activo y produciría deuda masiva sin una migración dedicada.

## Contratos que no se pueden reinterpretar durante la ejecución

### Semántica de detectores y clases

```text
detector covered       = sensor activo AND comando reconocido AND toda evidencia satisfecha
detector missing       = sensor ausente
detector disabled      = sensor presente con enabled:false
detector ineffective   = comando reconocido AND archivo/marker requerido ausente
detector unverifiable  = comando personalizado/no disponible OR lectura segura indecidible

class covered          = existe detector covered
class unverifiable     = ninguno covered AND existe detector unverifiable
class missing          = ninguno covered/unverifiable

overall gaps           = existe class missing
overall inconclusive   = no missing AND existe class unverifiable
overall covered        = todas las clases covered
```

La ausencia de manifiesto y la ausencia de referencia cortocircuitan antes de evaluar clases y producen respectivamente `inconclusive/not_configured` e `inconclusive/no_reference`. Todos esos estados informativos salen con código `0`; solo errores de lectura o contrato salen distinto de cero.

### Forma pública estable

```ts
export type CoverageEnvelope = {
    schemaVersion: 1;
    pack: string | null;
    registry: string | null;
    overall: 'covered' | 'gaps' | 'inconclusive';
    static: {
        status: 'covered' | 'gaps' | 'inconclusive';
        reason: null | 'not_configured' | 'no_reference';
        classes: CoverageClassResult[];
    };
    empirical?: unknown;
};
```

R2 nunca emite `empirical`; la propiedad solo documenta el punto de extensión compatible para R3. `schemaVersion` continúa en `1` mientras los campos existentes mantengan forma y significado.

## Estructura de archivos

| Archivo | Responsabilidad única |
|---|---|
| `cli/src/commands/sensors/coverage/contract.ts` | Tipos del contrato v1 y validación runtime recursiva de manifest/coverage |
| `cli/src/commands/sensors/coverage/evaluate.ts` | Reducir observaciones a estados de detector, clase y reporte de forma pura y determinista |
| `cli/src/commands/sensors/coverage/evidence.ts` | Inspección segura de comando, archivos y markers; nunca ejecuta ni escribe |
| `cli/src/commands/sensors/coverage/resolve.ts` | Lectura acotada del manifiesto y del primer pack exacto en el orden configurado |
| `cli/src/commands/sensors/coverage/render.ts` | Envelope v1 y vista humana sin filtrar comandos, markers ni contenido |
| `cli/src/commands/sensors/coverage/index.ts` | Orquestación del diagnóstico y traducción de fallos a errores accionables |
| `cli/src/commands/sensors/index.ts` | Wiring Commander de `coverage`, `--json` y exit code |
| `cli/tests/commands/sensors/coverage/*.test.ts` | Corpus contractual, estados, seguridad, resolución, render y orquestación |
| `cli/tests/integration/sensor-coverage.e2e.test.ts` | CLI compilado, fixture versionado, checkout real y prueba read-only |
| `cli/tests/fixtures/sensor-coverage/js-ts-gap/**` | Proyecto mínimo reproducible derivado del caso CA-1.1 |
| `docs/cli-reference.md` | Contrato de usuario, estados, JSON y códigos de salida |
| `docs/research/r2/README.md` | Procedencia, hash y comandos de reproducción de aceptación/provider |
| `docs/research/r2/provider-run.mjs` | Runner neutral que genera evidencia sanitizada desde el CLI local |
| `docs/research/r2/evidence/*.json` | Evidencia versionada Claude Code/Codex, sin secretos ni homes reales |
| `awm-baseline-registry/tests/sensor-pack-coverage.test.mjs` | Validador estructural v1 sobre todos los packs y catálogo exacto baseline |
| `awm-baseline-registry/tests/sensor-pack-coverage-mutations.test.mjs` | Mutaciones que demuestran que el gate rechaza versión, path, marker y clase inválidos |
| `awm-baseline-registry/sensor-packs/{generic,js-ts,python,shell}/pack.json` | Clases genéricas, detectores literales y remedios del pack |
| `awm-baseline-registry/.github/workflows/{validate,auto-tag}.yml` | Ejecución del nuevo gate antes de aceptar/publicar contenido |
| `awm-baseline-registry/{catalog.json,bundles/dev/bundle.json,CHANGELOG.md}` | Bump coordinado `dev` 2.9.0 → 2.10.0 y nota de contenido |

## Orden de ejecución y entrega

```text
T1 contrato runtime
  -> T2 evaluador puro
  -> T3 evidencia segura
  -> T4 resolución/orquestación
  -> T5 render + Commander + docs
  -> T6 aceptación local/provider
  -> PR CLI y publicación del consumidor
  -> T7 gate del registry
  -> T8 contratos de cuatro packs
  -> T9 mutaciones + versión + CI
  -> PR registry y auto-tag
  -> T10 reconciliación integral y handoff a R3
```

El PR de `agentic-workflow` debe quedar mergeado/publicado antes de mergear el PR de `awm-baseline-registry`. Un CLI nuevo tolera packs viejos; un pack nuevo no debe adelantarse a su consumidor.

### Task 1: Contrato v1 y validadores runtime fail-closed

_Requirements: R2.1, R2.7, R2.11, R2.13_

**Files:**
- Create: `cli/src/commands/sensors/coverage/contract.ts`
- Create: `cli/tests/commands/sensors/coverage/contract.test.ts`

**Skills:** `test-driven-development`

- [x] **Step 1: Crear el corpus rojo de contratos válidos e inválidos**

```ts
// cli/tests/commands/sensors/coverage/contract.test.ts
import { parseCoverageContract, parseCoverageManifest } from '../../../../src/commands/sensors/coverage/contract';

const valid = {
    schemaVersion: 1,
    classes: {
        formatting: {
            description: 'Mechanical formatting consistency',
            detectors: [{
                sensor: 'format',
                evidence: {
                    commandIncludes: ['prettier'],
                    files: [{ path: '.prettierrc', containsAll: [] }],
                },
            }],
            remedy: { summary: 'Add a formatter', command: 'npm install --save-dev prettier' },
        },
    },
};

describe('coverage contract v1', () => {
    test('accepts and normalizes the complete v1 shape (R2.1)', () => {
        expect(parseCoverageContract(valid, 'fixture/pack.json')).toEqual(valid);
    });

    test.each([
        [{ ...valid, schemaVersion: 2 }, /schemaVersion.*expected 1/],
        [{ ...valid, typo: true }, /unknown field.*typo/],
        [{ ...valid, classes: {} }, /classes.*non-empty/],
        [{ ...valid, classes: { Bad_ID: valid.classes.formatting } }, /class id/],
        [{ ...valid, classes: { formatting: { ...valid.classes.formatting, detectors: [] } } }, /detectors.*non-empty/],
        [{ ...valid, classes: { formatting: { ...valid.classes.formatting, description: ' ' } } }, /description.*non-empty/],
    ])('rejects malformed root/class data: %# (R2.7)', (input, message) => {
        expect(() => parseCoverageContract(input, 'fixture/pack.json')).toThrow(message as RegExp);
    });

    test.each(['', '.', '..', '../secret', 'a/../../secret', '/etc/passwd', 'C:\\secret', 'a\\..\\secret'])
        ('rejects hostile evidence path %p (R2.11)', (hostile) => {
            const input = structuredClone(valid);
            input.classes.formatting.detectors[0].evidence.files[0].path = hostile;
            expect(() => parseCoverageContract(input, 'fixture/pack.json')).toThrow(/relative evidence path/);
        });

    test('rejects unknown nested fields instead of ignoring a typo (R2.7)', () => {
        const input = structuredClone(valid) as typeof valid & { classes: Record<string, any> };
        input.classes.formatting.detectors[0].evidence.commandInclude = ['prettier'];
        expect(() => parseCoverageContract(input, 'fixture/pack.json')).toThrow(/unknown field.*commandInclude/);
    });
});

describe('coverage manifest boundary', () => {
    test('accepts current and legacy sensor fields needed by existing commands (R2.13)', () => {
        expect(parseCoverageManifest({
            pack: 'js-ts', concurrency: 2,
            sensors: { lint: { cmd: 'npx eslint .', fast: true, enabled: true, timeout: 30_000,
                changedCmd: 'npx eslint {files}', changedExtensions: ['.ts'], formatter: 'eslint-llm' } },
        }, 'fixture/.awm/sensors.json').pack).toBe('js-ts');
    });

    test.each([null, {}, { pack: '', sensors: {} }, { pack: 'js-ts', sensors: null },
        { pack: 'js-ts', sensors: { lint: { cmd: 3 } } }])
        ('rejects malformed manifest %# (R2.7)', (input) => {
            expect(() => parseCoverageManifest(input, 'fixture/.awm/sensors.json')).toThrow(/Invalid sensor manifest/);
        });
});
```

- [x] **Step 2: Ejecutar el test y confirmar que falla por módulo inexistente**

Run: `cd cli && npx jest tests/commands/sensors/coverage/contract.test.ts --runInBand`

Expected: FAIL con `Cannot find module .../coverage/contract`.

- [x] **Step 3: Implementar los tipos y guards recursivos**

```ts
// cli/src/commands/sensors/coverage/contract.ts
import path from 'path';
import type { SensorConfig } from '../types';

export const COVERAGE_SCHEMA_VERSION = 1 as const;
export const MAX_COVERAGE_FILE_BYTES = 1024 * 1024;
const ID = /^[a-z][a-z0-9-]*$/;
const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type CoverageFileRequirement = { path: string; containsAll: string[] };
export type CoverageEvidenceContract = {
    commandIncludes?: string[];
    files?: CoverageFileRequirement[];
};
export type CoverageDetectorContract = { sensor: string; evidence?: CoverageEvidenceContract };
export type CoverageClassContract = {
    description: string;
    detectors: CoverageDetectorContract[];
    remedy: { summary: string; command: string };
};
export type CoverageContract = {
    schemaVersion: 1;
    classes: Record<string, CoverageClassContract>;
};
export type CoverageManifest = {
    pack: string;
    sensors: Record<string, SensorConfig>;
    concurrency?: number;
};

const record = (x: unknown, where: string): Record<string, unknown> => {
    if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new Error(`${where}: expected object`);
    return x as Record<string, unknown>;
};
const fields = (x: Record<string, unknown>, allowed: readonly string[], where: string): void => {
    const extra = Object.keys(x).find((key) => !allowed.includes(key));
    if (extra) throw new Error(`${where}: unknown field '${extra}'`);
};
const text = (x: unknown, where: string): string => {
    if (typeof x !== 'string' || x.trim() === '') throw new Error(`${where}: expected non-empty string`);
    return x;
};
const textArray = (x: unknown, where: string, allowEmpty = false): string[] => {
    if (!Array.isArray(x) || (!allowEmpty && x.length === 0)) throw new Error(`${where}: expected non-empty array`);
    return x.map((item, index) => text(item, `${where}[${index}]`));
};
const logicalName = (x: unknown, where: string): string => {
    const value = text(x, where);
    if (!COMPONENT.test(value)) throw new Error(`${where}: invalid logical name '${value}'`);
    return value;
};
const relativeFile = (x: unknown, where: string): string => {
    const value = text(x, where);
    const segments = value.split(/[\\/]/);
    if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)
        || segments.some((part) => part === '' || part === '.' || part === '..')) {
        throw new Error(`${where}: expected safe relative evidence path`);
    }
    return value;
};

function parseEvidence(input: unknown, where: string): CoverageEvidenceContract {
    const x = record(input, where);
    fields(x, ['commandIncludes', 'files'], where);
    const out: CoverageEvidenceContract = {};
    if ('commandIncludes' in x) out.commandIncludes = textArray(x.commandIncludes, `${where}.commandIncludes`);
    if ('files' in x) {
        if (!Array.isArray(x.files) || x.files.length === 0) throw new Error(`${where}.files: expected non-empty array`);
        out.files = x.files.map((item, index) => {
            const file = record(item, `${where}.files[${index}]`);
            fields(file, ['path', 'containsAll'], `${where}.files[${index}]`);
            return {
                path: relativeFile(file.path, `${where}.files[${index}].path`),
                containsAll: textArray(file.containsAll, `${where}.files[${index}].containsAll`, true),
            };
        });
    }
    return out;
}

export function parseCoverageContract(input: unknown, source: unknown): CoverageContract {
    const label = text(source, 'coverage source');
    const root = record(input, `Invalid coverage contract at ${label}`);
    fields(root, ['schemaVersion', 'classes'], `Invalid coverage contract at ${label}`);
    if (root.schemaVersion !== COVERAGE_SCHEMA_VERSION) {
        throw new Error(`Invalid coverage contract at ${label}: schemaVersion expected 1`);
    }
    const rawClasses = record(root.classes, `Invalid coverage contract at ${label}.classes`);
    if (Object.keys(rawClasses).length === 0) throw new Error(`Invalid coverage contract at ${label}: classes must be non-empty`);
    const classes: Record<string, CoverageClassContract> = {};
    for (const id of Object.keys(rawClasses).sort()) {
        if (!ID.test(id)) throw new Error(`Invalid coverage contract at ${label}: invalid class id '${id}'`);
        const where = `Invalid coverage contract at ${label}.classes.${id}`;
        const value = record(rawClasses[id], where);
        fields(value, ['description', 'detectors', 'remedy'], where);
        if (!Array.isArray(value.detectors) || value.detectors.length === 0) throw new Error(`${where}.detectors: expected non-empty array`);
        const detectors = value.detectors.map((item, index): CoverageDetectorContract => {
            const detectorWhere = `${where}.detectors[${index}]`;
            const detector = record(item, detectorWhere);
            fields(detector, ['sensor', 'evidence'], detectorWhere);
            return {
                sensor: logicalName(detector.sensor, `${detectorWhere}.sensor`),
                ...('evidence' in detector ? { evidence: parseEvidence(detector.evidence, `${detectorWhere}.evidence`) } : {}),
            };
        });
        const remedy = record(value.remedy, `${where}.remedy`);
        fields(remedy, ['summary', 'command'], `${where}.remedy`);
        classes[id] = {
            description: text(value.description, `${where}.description`), detectors,
            remedy: { summary: text(remedy.summary, `${where}.remedy.summary`), command: text(remedy.command, `${where}.remedy.command`) },
        };
    }
    return { schemaVersion: 1, classes };
}

export function parseCoverageManifest(input: unknown, source: unknown): CoverageManifest {
    const label = text(source, 'manifest source');
    const root = record(input, `Invalid sensor manifest at ${label}`);
    fields(root, ['pack', 'sensors', 'concurrency'], `Invalid sensor manifest at ${label}`);
    const rawSensors = record(root.sensors, `Invalid sensor manifest at ${label}.sensors`);
    const sensors: Record<string, SensorConfig> = {};
    for (const [name, raw] of Object.entries(rawSensors)) {
        logicalName(name, `Invalid sensor manifest at ${label}.sensors key`);
        const sensor = record(raw, `Invalid sensor manifest at ${label}.sensors.${name}`);
        fields(sensor, ['cmd', 'fast', 'enabled', 'timeout', 'changedCmd', 'changedExtensions', 'formatter'], `Invalid sensor manifest at ${label}.sensors.${name}`);
        if ('cmd' in sensor && typeof sensor.cmd !== 'string') throw new Error(`Invalid sensor manifest at ${label}: ${name}.cmd must be string`);
        if ('fast' in sensor && typeof sensor.fast !== 'boolean') throw new Error(`Invalid sensor manifest at ${label}: ${name}.fast must be boolean`);
        if ('enabled' in sensor && typeof sensor.enabled !== 'boolean') throw new Error(`Invalid sensor manifest at ${label}: ${name}.enabled must be boolean`);
        if ('timeout' in sensor && (typeof sensor.timeout !== 'number' || !Number.isSafeInteger(sensor.timeout) || sensor.timeout <= 0)) throw new Error(`Invalid sensor manifest at ${label}: ${name}.timeout must be a positive integer`);
        if ('changedCmd' in sensor && typeof sensor.changedCmd !== 'string') throw new Error(`Invalid sensor manifest at ${label}: ${name}.changedCmd must be string`);
        if ('changedExtensions' in sensor && (!Array.isArray(sensor.changedExtensions) || sensor.changedExtensions.some((ext) => typeof ext !== 'string'))) throw new Error(`Invalid sensor manifest at ${label}: ${name}.changedExtensions must be string[]`);
        if ('formatter' in sensor && typeof sensor.formatter !== 'string') throw new Error(`Invalid sensor manifest at ${label}: ${name}.formatter must be string`);
        sensors[name] = sensor as SensorConfig;
    }
    if ('concurrency' in root && (typeof root.concurrency !== 'number' || !Number.isSafeInteger(root.concurrency) || root.concurrency <= 0)) throw new Error(`Invalid sensor manifest at ${label}: concurrency must be a positive integer`);
    return { pack: logicalName(root.pack, `Invalid sensor manifest at ${label}.pack`), sensors,
        ...(root.concurrency === undefined ? {} : { concurrency: root.concurrency as number }) };
}
```

- [x] **Step 4: Ejecutar contrato + build**

Run: `cd cli && npx jest tests/commands/sensors/coverage/contract.test.ts --runInBand && npm run build`

Expected: PASS y build sin errores TypeScript.

- [x] **Step 5: Confirmar la mutación discriminante**

Cambiar temporalmente `fields(detector, ['sensor', 'evidence'], detectorWhere)` para incluir `commandInclude`, correr el caso `rejects unknown nested fields`, observar FAIL, restaurar la línea y observar PASS. No commitear la mutación.

- [x] **Step 6: Commit del contrato**

```bash
git add cli/src/commands/sensors/coverage/contract.ts cli/tests/commands/sensors/coverage/contract.test.ts
git commit -m "feat(sensors): validate coverage contract v1"
```

### Task 2: Evaluador puro y precedencia determinista

_Requirements: RF-1.1, R2.2, R2.3, R2.4, R2.5, R2.5a, R2.5b, R2.10, R2.14_

**Files:**
- Create: `cli/src/commands/sensors/coverage/evaluate.ts`
- Create: `cli/tests/commands/sensors/coverage/evaluate.test.ts`

**Skills:** `test-driven-development`

- [ ] **Step 1: Escribir la tabla roja de estados y precedencia**

```ts
// cli/tests/commands/sensors/coverage/evaluate.test.ts
import { evaluateCoverage, type IndexedDetectorObservation } from '../../../../src/commands/sensors/coverage/evaluate';
import type { CoverageContract } from '../../../../src/commands/sensors/coverage/contract';

const contract: CoverageContract = {
    schemaVersion: 1,
    classes: {
        alpha: { description: 'Alpha', detectors: [{ sensor: 'one' }, { sensor: 'two' }], remedy: { summary: 'Fix alpha', command: 'fix alpha' } },
        zeta: { description: 'Zeta', detectors: [{ sensor: 'three' }], remedy: { summary: 'Fix zeta', command: 'fix zeta' } },
    },
};
const observation = (classId: string, detectorIndex: number, sensor: string,
    status: IndexedDetectorObservation['status']): IndexedDetectorObservation =>
    ({ classId, detectorIndex, sensor, status, evidence: [] });

describe('coverage evaluation', () => {
    test.each([
        [[observation('alpha', 0, 'one', 'covered'), observation('alpha', 1, 'two', 'missing')], 'covered'],
        [[observation('alpha', 0, 'one', 'missing'), observation('alpha', 1, 'two', 'disabled')], 'missing'],
        [[observation('alpha', 0, 'one', 'ineffective'), observation('alpha', 1, 'two', 'missing')], 'missing'],
        [[observation('alpha', 0, 'one', 'unverifiable'), observation('alpha', 1, 'two', 'missing')], 'unverifiable'],
    ] as const)('reduces detector alternatives %j to %s (R2.2-R2.5b)', (alpha, expected) => {
        const result = evaluateCoverage(contract, [...alpha, observation('zeta', 0, 'three', 'covered')]);
        expect(result.classes.find((item) => item.id === 'alpha')?.status).toBe(expected);
    });

    test('gaps outrank unverifiable globally while preserving both classes (R2.5b)', () => {
        const result = evaluateCoverage(contract, [observation('alpha', 0, 'one', 'unverifiable'), observation('alpha', 1, 'two', 'missing'), observation('zeta', 0, 'three', 'missing')]);
        expect(result.overall).toBe('gaps');
        expect(result.classes.map((item) => [item.id, item.status])).toEqual([['alpha', 'unverifiable'], ['zeta', 'missing']]);
    });

    test('sorts classes by stable id for identical input (R2.10)', () => {
        const result = evaluateCoverage(contract, [observation('zeta', 0, 'three', 'covered'), observation('alpha', 1, 'two', 'missing'), observation('alpha', 0, 'one', 'covered')]);
        expect(result.classes.map((item) => item.id)).toEqual(['alpha', 'zeta']);
        expect(evaluateCoverage(contract, [observation('alpha', 0, 'one', 'covered'), observation('zeta', 0, 'three', 'covered'), observation('alpha', 1, 'two', 'missing')])).toEqual(result);
    });

    test('fails loudly when an observation is missing or duplicated', () => {
        expect(() => evaluateCoverage(contract, [])).toThrow(/missing observation.*one/);
        expect(() => evaluateCoverage(contract, [observation('alpha', 0, 'one', 'covered'), observation('alpha', 0, 'one', 'covered'), observation('alpha', 1, 'two', 'covered'), observation('zeta', 0, 'three', 'covered')])).toThrow(/duplicate observation.*alpha:0/);
    });
});
```

- [ ] **Step 2: Ejecutar el test rojo**

Run: `cd cli && npx jest tests/commands/sensors/coverage/evaluate.test.ts --runInBand`

Expected: FAIL por módulo inexistente.

- [ ] **Step 3: Implementar el reducer puro y sus tipos de salida**

```ts
// cli/src/commands/sensors/coverage/evaluate.ts
import type { CoverageContract } from './contract';

export type DetectorStatus = 'covered' | 'missing' | 'disabled' | 'ineffective' | 'unverifiable';
export type CoverageEvidenceResult =
    | { kind: 'command'; status: 'matched' | 'custom' | 'missing' }
    | { kind: 'file'; path: string; status: 'matched' | 'missing' | 'unverifiable' }
    | { kind: 'marker'; path: string; ordinal: number; status: 'matched' | 'missing' | 'unverifiable' };
export type DetectorObservation = { sensor: string; status: DetectorStatus; evidence: CoverageEvidenceResult[] };
export type IndexedDetectorObservation = DetectorObservation & { classId: string; detectorIndex: number };
export type CoverageClassResult = {
    id: string;
    description: string;
    status: 'covered' | 'missing' | 'unverifiable';
    detectors: DetectorObservation[];
    remedy: { summary: string; command: string };
};
export type StaticCoverageResult = { overall: 'covered' | 'gaps' | 'inconclusive'; classes: CoverageClassResult[] };

const keyFor = (classId: string, detectorIndex: number): string => `${classId}:${detectorIndex}`;

export function evaluateCoverage(contract: CoverageContract, observations: IndexedDetectorObservation[]): StaticCoverageResult {
    if (!contract || contract.schemaVersion !== 1) throw new Error('evaluateCoverage: invalid coverage contract');
    if (!Array.isArray(observations)) throw new Error('evaluateCoverage: observations must be an array');
    const indexed = new Map<string, IndexedDetectorObservation>();
    for (const item of observations) {
        if (!item || typeof item.classId !== 'string' || !Number.isSafeInteger(item.detectorIndex)
            || typeof item.sensor !== 'string' || !Array.isArray(item.evidence)) {
            throw new Error('evaluateCoverage: malformed observation');
        }
        const key = keyFor(item.classId, item.detectorIndex);
        if (indexed.has(key)) throw new Error(`evaluateCoverage: duplicate observation for '${key}'`);
        indexed.set(key, item);
    }
    const classes = Object.keys(contract.classes).sort().map((id): CoverageClassResult => {
        const expected = contract.classes[id];
        const detectors = expected.detectors.map((detector, detectorIndex): DetectorObservation => {
            const found = indexed.get(keyFor(id, detectorIndex));
            if (!found) throw new Error(`evaluateCoverage: missing observation for '${id}:${detectorIndex}' (${detector.sensor})`);
            return { sensor: found.sensor, status: found.status, evidence: found.evidence };
        });
        const status = detectors.some((item) => item.status === 'covered') ? 'covered'
            : detectors.some((item) => item.status === 'unverifiable') ? 'unverifiable'
            : 'missing';
        return { id, description: expected.description, status, detectors, remedy: expected.remedy };
    });
    const overall = classes.some((item) => item.status === 'missing') ? 'gaps'
        : classes.some((item) => item.status === 'unverifiable') ? 'inconclusive'
        : 'covered';
    return { overall, classes };
}
```

- [ ] **Step 4: Agregar el test de detectores alternativos con el mismo sensor**

```ts
test('keeps two alternatives for the same sensor independent (R2.2)', () => {
    const sameSensor: CoverageContract = { schemaVersion: 1, classes: { config: {
        description: 'Project configuration',
        detectors: [{ sensor: 'lint' }, { sensor: 'lint' }],
        remedy: { summary: 'Add config', command: 'touch eslint.config.js' },
    } } };
    const result = evaluateCoverage(sameSensor, [
        { classId: 'config', detectorIndex: 0, sensor: 'lint', status: 'ineffective', evidence: [] },
        { classId: 'config', detectorIndex: 1, sensor: 'lint', status: 'covered', evidence: [] },
    ]);
    expect(result.classes[0].status).toBe('covered');
    expect(result.classes[0].detectors).toHaveLength(2);
});
```

- [ ] **Step 5: Ejecutar evaluador + contrato + build**

Run: `cd cli && npx jest tests/commands/sensors/coverage/contract.test.ts tests/commands/sensors/coverage/evaluate.test.ts --runInBand && npm run build`

Expected: PASS. La implementación final usa identidad `classId + detectorIndex`, no solamente `sensor`.

- [ ] **Step 6: Revertir temporalmente la precedencia `unverifiable` y probar rojo/verde**

Cambiar temporalmente la reducción de clase para devolver `missing` ante `[unverifiable, missing]`; el caso correspondiente debe fallar. Restaurar y confirmar PASS antes del commit.

- [ ] **Step 7: Commit del evaluador**

```bash
git add cli/src/commands/sensors/coverage/evaluate.ts cli/tests/commands/sensors/coverage/evaluate.test.ts
git commit -m "feat(sensors): evaluate static coverage states"
```

### Task 3: Recolección segura de evidencia local

_Requirements: RF-1.4, R2.2, R2.3, R2.4, R2.5, R2.5a, R2.9, R2.11_

**Files:**
- Create: `cli/src/commands/sensors/coverage/evidence.ts`
- Create: `cli/tests/commands/sensors/coverage/evidence.test.ts`

**Skills:** `test-driven-development`

- [ ] **Step 1: Escribir tests rojos para comando, archivos, markers y límites**

```ts
// cli/tests/commands/sensors/coverage/evidence.test.ts
import fs from 'fs';
import path from 'path';
import { mkCanonicalTmpDir } from '../../../support/tmp';
import { observeDetector } from '../../../../src/commands/sensors/coverage/evidence';
import { MAX_COVERAGE_FILE_BYTES, type CoverageDetectorContract } from '../../../../src/commands/sensors/coverage/contract';

let root: string;
beforeEach(() => { root = mkCanonicalTmpDir('awm-coverage-evidence-'); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const detector: CoverageDetectorContract = { sensor: 'lint', evidence: {
    commandIncludes: ['eslint', '--config'],
    files: [{ path: 'eslint.config.js', containsAll: ['no-unreachable'] }],
} };

test('active matching sensor with all AND evidence is covered (R2.2)', () => {
    fs.writeFileSync(path.join(root, 'eslint.config.js'), "rules: { 'no-unreachable': 'error' }");
    expect(observeDetector(root, 'style', 0, detector, { cmd: 'npx eslint . --config eslint.config.js', enabled: true }).status).toBe('covered');
});

test.each([
    [undefined, 'missing'],
    [{ cmd: 'npx eslint .', enabled: false }, 'disabled'],
    [{ cmd: 'custom-linter .' }, 'unverifiable'],
] as const)('maps sensor availability/config %# to %s (R2.3, R2.5)', (sensor, expected) => {
    expect(observeDetector(root, 'style', 0, detector, sensor).status).toBe(expected);
});

test('recognized command plus missing file is ineffective (R2.4)', () => {
    const out = observeDetector(root, 'style', 0, detector, { cmd: 'eslint --config eslint.config.js' });
    expect(out.status).toBe('ineffective');
    expect(out.evidence).toContainEqual({ kind: 'file', path: 'eslint.config.js', status: 'missing' });
});

test('recognized command plus missing literal marker is ineffective (R2.4)', () => {
    fs.writeFileSync(path.join(root, 'eslint.config.js'), 'export default []');
    const out = observeDetector(root, 'style', 0, detector, { cmd: 'eslint --config eslint.config.js' });
    expect(out.status).toBe('ineffective');
    expect(out.evidence).toContainEqual({ kind: 'marker', path: 'eslint.config.js', ordinal: 1, status: 'missing' });
});

test.each(['symlink', 'oversize'] as const)('%s evidence is unverifiable, never green or missing (R2.5a, R2.11)', (kind) => {
    const target = path.join(root, 'target.js');
    fs.writeFileSync(target, 'no-unreachable');
    const file = path.join(root, 'eslint.config.js');
    if (kind === 'symlink') fs.symlinkSync(target, file);
    if (kind === 'oversize') fs.writeFileSync(file, Buffer.alloc(MAX_COVERAGE_FILE_BYTES + 1));
    expect(observeDetector(root, 'style', 0, detector, { cmd: 'eslint --config eslint.config.js' }).status).toBe('unverifiable');
});

test('read errors are unverifiable independently of host permissions (R2.5a)', () => {
    fs.writeFileSync(path.join(root, 'eslint.config.js'), 'no-unreachable');
    const io = {
        lstatSync: fs.lstatSync,
        readFileUtf8: () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); },
    };
    expect(observeDetector(root, 'style', 0, detector,
        { cmd: 'eslint --config eslint.config.js' }, io).status).toBe('unverifiable');
});

test('reports only ordinal/path/status and never leaks command or marker text (RF-1.4)', () => {
    fs.writeFileSync(path.join(root, 'eslint.config.js'), 'secret-marker');
    const serialized = JSON.stringify(observeDetector(root, 'style', 0, detector, { cmd: 'private-command eslint --config' }));
    expect(serialized).not.toContain('private-command');
    expect(serialized).not.toContain('no-unreachable');
});
```

- [ ] **Step 2: Ejecutar el test rojo**

Run: `cd cli && npx jest tests/commands/sensors/coverage/evidence.test.ts --runInBand`

Expected: FAIL por módulo inexistente.

- [ ] **Step 3: Implementar `observeDetector` sin subprocess ni dereferencia**

```ts
// cli/src/commands/sensors/coverage/evidence.ts
import fs from 'fs';
import path from 'path';
import type { SensorConfig } from '../types';
import { MAX_COVERAGE_FILE_BYTES, type CoverageDetectorContract } from './contract';
import type { CoverageEvidenceResult, IndexedDetectorObservation } from './evaluate';
export type EvidenceIo = { lstatSync: (file: string) => fs.Stats; readFileUtf8: (file: string) => string };
const realIo: EvidenceIo = { lstatSync: fs.lstatSync, readFileUtf8: (file) => fs.readFileSync(file, 'utf8') };

function inspectFile(root: string, relative: string, markers: string[], io: EvidenceIo): { status: 'matched' | 'missing' | 'unverifiable'; evidence: CoverageEvidenceResult[] } {
    const absolute = path.resolve(root, relative);
    const rootPrefix = path.resolve(root) + path.sep;
    if (!absolute.startsWith(rootPrefix)) throw new Error(`evidence path escaped project root: ${relative}`);
    let stat: fs.Stats;
    try { stat = io.lstatSync(absolute); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing', evidence: [{ kind: 'file', path: relative, status: 'missing' }] };
        return { status: 'unverifiable', evidence: [{ kind: 'file', path: relative, status: 'unverifiable' }] };
    }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_COVERAGE_FILE_BYTES) {
        return { status: 'unverifiable', evidence: [{ kind: 'file', path: relative, status: 'unverifiable' }] };
    }
    let content: string;
    try { content = io.readFileUtf8(absolute); }
    catch { return { status: 'unverifiable', evidence: [{ kind: 'file', path: relative, status: 'unverifiable' }] }; }
    const evidence: CoverageEvidenceResult[] = [{ kind: 'file', path: relative, status: 'matched' }];
    markers.forEach((marker, index) => evidence.push({ kind: 'marker', path: relative, ordinal: index + 1, status: content.includes(marker) ? 'matched' : 'missing' }));
    return { status: evidence.some((item) => item.kind === 'marker' && item.status === 'missing') ? 'missing' : 'matched', evidence };
}

export function observeDetector(root: unknown, classId: unknown, detectorIndex: unknown,
    detector: CoverageDetectorContract, sensor: SensorConfig | undefined,
    io: EvidenceIo = realIo): IndexedDetectorObservation {
    if (typeof root !== 'string' || root === '') throw new Error('observeDetector: root must be a non-empty string');
    if (typeof classId !== 'string' || classId === '') throw new Error('observeDetector: classId must be a non-empty string');
    if (!Number.isSafeInteger(detectorIndex) || (detectorIndex as number) < 0) throw new Error('observeDetector: detectorIndex must be a non-negative integer');
    const base = { classId, detectorIndex: detectorIndex as number, sensor: detector.sensor };
    if (!sensor) return { ...base, status: 'missing', evidence: [] };
    if (sensor.enabled === false) return { ...base, status: 'disabled', evidence: [] };
    const required = detector.evidence?.commandIncludes ?? [];
    const command = sensor.cmd;
    if (required.length > 0 && typeof command !== 'string') return { ...base, status: 'unverifiable', evidence: [{ kind: 'command', status: 'missing' }] };
    if (required.some((fragment) => !command!.includes(fragment))) return { ...base, status: 'unverifiable', evidence: [{ kind: 'command', status: 'custom' }] };
    const evidence: CoverageEvidenceResult[] = required.length > 0 ? [{ kind: 'command', status: 'matched' }] : [];
    let ineffective = false;
    let unverifiable = false;
    for (const file of detector.evidence?.files ?? []) {
        const result = inspectFile(root, file.path, file.containsAll, io);
        evidence.push(...result.evidence);
        ineffective ||= result.status === 'missing';
        unverifiable ||= result.status === 'unverifiable';
    }
    return { ...base, status: unverifiable ? 'unverifiable' : ineffective ? 'ineffective' : 'covered', evidence };
}
```

- [ ] **Step 4: Ajustar el caso de permisos para plataformas donde root puede leer `000`**

El test no debe fingir que `chmod 000` siempre produce `EACCES`. El tipo `EvidenceIo` del Step 3 permite hacer que el test `unreadable` lance `EACCES`; mantener tests reales separados para symlink y tamaño.

```ts
    const io = {
        lstatSync: fs.lstatSync,
        readFileUtf8: () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); },
    };
expect(observeDetector(root, 'style', 0, detector,
    { cmd: 'eslint --config eslint.config.js' }, io).status).toBe('unverifiable');
```

- [ ] **Step 5: Ejecutar evidencia + evaluador + build**

Run: `cd cli && npx jest tests/commands/sensors/coverage/evidence.test.ts tests/commands/sensors/coverage/evaluate.test.ts --runInBand && npm run build`

Expected: PASS.

- [ ] **Step 6: Probar la mutación de symlink**

Cambiar temporalmente `lstatSync` por `statSync`; el caso symlink debe fallar. Restaurar `lstatSync` y confirmar PASS.

- [ ] **Step 7: Commit de evidencia segura**

```bash
git add cli/src/commands/sensors/coverage/evidence.ts cli/tests/commands/sensors/coverage/evidence.test.ts
git commit -m "feat(sensors): inspect coverage evidence safely"
```

### Task 4: Resolución multi-registry y orquestación read-only

_Requirements: RF-1.4, RF-1.5, R2.6, R2.7, R2.9, R2.11, R2.12, R2.13, R2.14_

**Files:**
- Create: `cli/src/commands/sensors/coverage/resolve.ts`
- Create: `cli/src/commands/sensors/coverage/index.ts`
- Create: `cli/tests/commands/sensors/coverage/resolve.test.ts`
- Create: `cli/tests/commands/sensors/coverage/index.test.ts`

**Skills:** `test-driven-development`

- [ ] **Step 1: Escribir tests rojos de lectura acotada y precedencia de registries**

```ts
// cli/tests/commands/sensors/coverage/resolve.test.ts
import fs from 'fs';
import path from 'path';
import { mkCanonicalTmpDir } from '../../../support/tmp';
import { resolveCoverageInputs } from '../../../../src/commands/sensors/coverage/resolve';

let root: string;
let awmHome: string;
let project: string;
beforeEach(() => {
    root = mkCanonicalTmpDir('awm-coverage-resolve-');
    awmHome = path.join(root, 'home');
    project = path.join(root, 'project');
    fs.mkdirSync(path.join(project, '.awm'), { recursive: true });
    process.env.AWM_HOME = awmHome;
});
afterEach(() => { delete process.env.AWM_HOME; fs.rmSync(root, { recursive: true, force: true }); });

const configure = (names: string[]) => {
    fs.mkdirSync(awmHome, { recursive: true });
    fs.writeFileSync(path.join(awmHome, 'registries.json'), JSON.stringify(names.map((name) => ({ name, remote: 'fixture' }))));
};
const writeManifest = (body: unknown) => fs.writeFileSync(path.join(project, '.awm', 'sensors.json'),
    typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
const writePack = (registry: string, pack: string, body: object) => {
    const dir = path.join(awmHome, 'registries', registry, 'sensor-packs', pack);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(body));
};

test('no manifest returns not_configured without reading registries (R2.6)', () => {
    fs.rmSync(path.join(project, '.awm', 'sensors.json'), { force: true });
    fs.mkdirSync(awmHome, { recursive: true });
    fs.writeFileSync(path.join(awmHome, 'registries.json'), '{malformed');
    expect(resolveCoverageInputs(project)).toEqual({ kind: 'not_configured' });
});

test('selects the first configured registry containing the exact pack (R2.12)', () => {
    writeManifest({ pack: 'js-ts', sensors: {} });
    configure(['first', 'second']);
    writePack('first', 'generic', { name: 'generic', sensors: {} });
    writePack('second', 'js-ts', { name: 'js-ts', sensors: {}, coverage: { schemaVersion: 1, classes: {
        formatting: { description: 'Formatting', detectors: [{ sensor: 'format' }], remedy: { summary: 'Add formatter', command: 'npm i -D prettier' } },
    } } });
    expect(resolveCoverageInputs(project)).toMatchObject({ kind: 'ready', pack: 'js-ts', registry: 'second' });
});

test('old pack without coverage is no_reference, not covered (RF-1.5, R2.13)', () => {
    writeManifest({ pack: 'js-ts', sensors: {} });
    configure(['baseline']);
    writePack('baseline', 'js-ts', { name: 'js-ts', sensors: {} });
    expect(resolveCoverageInputs(project)).toMatchObject({
        kind: 'no_reference', pack: 'js-ts', registry: 'baseline',
    });
});

test.each([
    ['manifest-malformed', '{broken', /Invalid JSON.*sensors\.json/],
    ['manifest-oversize', Buffer.alloc(1024 * 1024 + 1), /sensors\.json.*exceeds 1 MiB/],
] as const)('rejects %s (R2.7, R2.11)', (_name, body, expected) => {
    writeManifest(body);
    expect(() => resolveCoverageInputs(project)).toThrow(expected);
});

test.each([
    ['pack-malformed', '{broken', /Invalid JSON.*pack\.json/],
    ['pack-oversize', Buffer.alloc(1024 * 1024 + 1), /pack\.json.*exceeds 1 MiB/],
] as const)('rejects %s (R2.7, R2.11)', (_name, body, expected) => {
    writeManifest({ pack: 'js-ts', sensors: {} });
    configure(['baseline']);
    const dir = path.join(awmHome, 'registries', 'baseline', 'sensor-packs', 'js-ts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack.json'), body);
    expect(() => resolveCoverageInputs(project)).toThrow(expected);
});

test('rejects a JSON object that is not a valid pack (R2.7)', () => {
    writeManifest({ pack: 'js-ts', sensors: {} });
    configure(['baseline']);
    writePack('baseline', 'js-ts', { coverage: { schemaVersion: 1, classes: {} } });
    expect(() => resolveCoverageInputs(project)).toThrow(/Invalid pack.*name/);
});
```

- [ ] **Step 2: Ejecutar resolución en rojo**

Run: `cd cli && npx jest tests/commands/sensors/coverage/resolve.test.ts --runInBand`

Expected: FAIL por módulo inexistente.

- [ ] **Step 3: Implementar lectura bounded y resolución exacta**

```ts
// cli/src/commands/sensors/coverage/resolve.ts
import fs from 'fs';
import path from 'path';
import { findManifestDir } from '../run';
import { listRegistries } from '../../../core/registries';
import { MAX_COVERAGE_FILE_BYTES, parseCoverageContract, parseCoverageManifest,
    type CoverageContract, type CoverageManifest } from './contract';

export type CoverageInputs =
    | { kind: 'not_configured' }
    | { kind: 'no_reference'; projectRoot: string; pack: string; registry: string; manifest: CoverageManifest }
    | { kind: 'ready'; projectRoot: string; pack: string; registry: string; manifest: CoverageManifest; contract: CoverageContract };

export function readBoundedJson(file: unknown): unknown {
    if (typeof file !== 'string' || file === '') throw new Error('readBoundedJson: file must be a non-empty string');
    let stat: fs.Stats;
    try { stat = fs.lstatSync(file); }
    catch (error) { throw new Error(`Cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`); }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Cannot read ${file}: expected a regular file`);
    if (stat.size > MAX_COVERAGE_FILE_BYTES) throw new Error(`Cannot read ${file}: exceeds 1 MiB limit`);
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown; }
    catch (error) { throw new Error(`Invalid JSON at ${file}: ${error instanceof Error ? error.message : String(error)}`); }
}

function readPackEnvelope(input: unknown, file: string, expectedName: string): { coverage?: unknown } {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new Error(`Invalid pack at ${file}: expected object`);
    }
    const pack = input as Record<string, unknown>;
    if (typeof pack.name !== 'string' || pack.name !== expectedName) {
        throw new Error(`Invalid pack at ${file}: name must equal '${expectedName}'`);
    }
    if (typeof pack.sensors !== 'object' || pack.sensors === null || Array.isArray(pack.sensors)) {
        throw new Error(`Invalid pack at ${file}: sensors must be an object`);
    }
    return 'coverage' in pack ? { coverage: pack.coverage } : {};
}

export function resolveCoverageInputs(cwd: unknown): CoverageInputs {
    if (typeof cwd !== 'string' || cwd === '') throw new Error('resolveCoverageInputs: cwd must be a non-empty string');
    const projectRoot = findManifestDir(cwd);
    if (!projectRoot) return { kind: 'not_configured' };
    const manifestPath = path.join(projectRoot, '.awm', 'sensors.json');
    const manifest = parseCoverageManifest(readBoundedJson(manifestPath), manifestPath);
    for (const registry of listRegistries()) {
        const packPath = path.join(registry.contentRoot, 'sensor-packs', manifest.pack, 'pack.json');
        if (!fs.existsSync(packPath)) continue;
        const { coverage } = readPackEnvelope(readBoundedJson(packPath), packPath, manifest.pack);
        if (coverage === undefined) return { kind: 'no_reference', projectRoot, pack: manifest.pack, registry: registry.name, manifest };
        return { kind: 'ready', projectRoot, pack: manifest.pack, registry: registry.name,
            manifest, contract: parseCoverageContract(coverage, packPath) };
    }
    throw new Error(`Pack '${manifest.pack}' was not found in configured registries`);
}
```

- [ ] **Step 4: Escribir tests rojos del orquestador para los tres caminos**

```ts
// cli/tests/commands/sensors/coverage/index.test.ts
import { runCoverage } from '../../../../src/commands/sensors/coverage';

test('not configured is explicit, actionable and exit-0 data (R2.6, R2.9)', () => {
    expect(runCoverage('/fixture', { resolve: () => ({ kind: 'not_configured' }) })).toEqual({
        schemaVersion: 1, pack: null, registry: null, overall: 'inconclusive',
        static: { status: 'inconclusive', reason: 'not_configured', classes: [] },
    });
});

test('old pack is no_reference and preserves pack/registry (RF-1.5, R2.13)', () => {
    const manifest = { pack: 'legacy', sensors: {} };
    expect(runCoverage('/fixture', { resolve: () => ({ kind: 'no_reference', projectRoot: '/fixture', pack: 'legacy', registry: 'baseline', manifest }) })).toMatchObject({
        pack: 'legacy', registry: 'baseline', overall: 'inconclusive', static: { reason: 'no_reference', classes: [] },
    });
});

test('ready input observes every declared detector and evaluates once (RF-1.1)', () => {
    const manifest = { pack: 'js-ts', sensors: { lint: { cmd: 'eslint .' }, format: { cmd: 'prettier --check .' } } };
    const contract = { schemaVersion: 1 as const, classes: {
        formatting: { description: 'Formatting', detectors: [{ sensor: 'format' }], remedy: { summary: 'Add format', command: 'npm i -D prettier' } },
        linting: { description: 'Linting', detectors: [{ sensor: 'lint' }], remedy: { summary: 'Add lint', command: 'npm i -D eslint' } },
    } };
    const observe = jest.fn((root, classId, detectorIndex, detector) => ({
        classId, detectorIndex, sensor: detector.sensor, status: 'covered' as const, evidence: [],
    }));
    const out = runCoverage('/fixture', { resolve: () => ({ kind: 'ready', projectRoot: '/fixture', pack: 'js-ts', registry: 'baseline', manifest, contract }), observe });
    expect(observe.mock.calls.map((call) => [call[1], call[2]])).toEqual([['formatting', 0], ['linting', 0]]);
    expect(out.static.classes.map((item) => item.id)).toEqual(['formatting', 'linting']);
    expect(out.overall).toBe('covered');
});
```

- [ ] **Step 5: Implementar `runCoverage` con dependencias inyectables solo para tests**

```ts
// cli/src/commands/sensors/coverage/index.ts
import { observeDetector } from './evidence';
import { evaluateCoverage, type CoverageClassResult, type IndexedDetectorObservation } from './evaluate';
import { resolveCoverageInputs, type CoverageInputs } from './resolve';

export type CoverageEnvelope = {
    schemaVersion: 1;
    pack: string | null;
    registry: string | null;
    overall: 'covered' | 'gaps' | 'inconclusive';
    static: { status: 'covered' | 'gaps' | 'inconclusive'; reason: null | 'not_configured' | 'no_reference'; classes: CoverageClassResult[] };
    empirical?: unknown;
};
type Dependencies = {
    resolve: (cwd: string) => CoverageInputs;
    observe: typeof observeDetector;
};
const defaults: Dependencies = { resolve: resolveCoverageInputs, observe: observeDetector };

export function runCoverage(cwd: unknown, dependencies: Partial<Dependencies> = {}): CoverageEnvelope {
    if (typeof cwd !== 'string' || cwd === '') throw new Error('runCoverage: cwd must be a non-empty string');
    const deps = { ...defaults, ...dependencies };
    const input = deps.resolve(cwd);
    if (input.kind === 'not_configured') return { schemaVersion: 1, pack: null, registry: null, overall: 'inconclusive', static: { status: 'inconclusive', reason: 'not_configured', classes: [] } };
    if (input.kind === 'no_reference') return { schemaVersion: 1, pack: input.pack, registry: input.registry, overall: 'inconclusive', static: { status: 'inconclusive', reason: 'no_reference', classes: [] } };
    const observations: IndexedDetectorObservation[] = [];
    for (const [classId, value] of Object.entries(input.contract.classes)) {
        value.detectors.forEach((detector, detectorIndex) => {
            observations.push(deps.observe(input.projectRoot, classId, detectorIndex, detector, input.manifest.sensors[detector.sensor]));
        });
    }
    const evaluated = evaluateCoverage(input.contract, observations);
    return { schemaVersion: 1, pack: input.pack, registry: input.registry, overall: evaluated.overall,
        static: { status: evaluated.overall, reason: null, classes: evaluated.classes } };
}
```

- [ ] **Step 6: Ejecutar resolución, orquestación y build**

Run: `cd cli && npx jest tests/commands/sensors/coverage/resolve.test.ts tests/commands/sensors/coverage/index.test.ts --runInBand && npm run build`

Expected: PASS.

- [ ] **Step 7: Mutar el orden de registries y confirmar discriminación**

Cambiar temporalmente el loop a `listRegistries().reverse()`; el test multi-registry debe fallar nombrando `first`/`second`. Restaurar y confirmar PASS.

- [ ] **Step 8: Commit de resolución y orquestación**

```bash
git add cli/src/commands/sensors/coverage/resolve.ts cli/src/commands/sensors/coverage/index.ts cli/tests/commands/sensors/coverage/resolve.test.ts cli/tests/commands/sensors/coverage/index.test.ts
git commit -m "feat(sensors): resolve static coverage inputs"
```

### Task 5: Render humano, JSON versionado y wiring Commander

_Requirements: RF-1.1, R2.6, R2.7, R2.8, R2.9, R2.10, R2.14, RNF-T.2_

**Files:**
- Create: `cli/src/commands/sensors/coverage/render.ts`
- Create: `cli/tests/commands/sensors/coverage/render.test.ts`
- Modify: `cli/src/commands/sensors/index.ts`
- Modify: `cli/tests/commands/sensors/index.test.ts`
- Modify: `docs/cli-reference.md`

**Skills:** `test-driven-development`

- [ ] **Step 1: Escribir tests rojos de render sin color/secretos**

```ts
// cli/tests/commands/sensors/coverage/render.test.ts
import { renderCoverageHuman, renderCoverageJson } from '../../../../src/commands/sensors/coverage/render';

const report = {
    schemaVersion: 1 as const, pack: 'js-ts', registry: 'baseline', overall: 'gaps' as const,
    static: { status: 'gaps' as const, reason: null, classes: [
        { id: 'formatting', description: 'Formatting', status: 'missing' as const,
          detectors: [{ sensor: 'format', status: 'missing' as const, evidence: [] }],
          remedy: { summary: 'Add formatter', command: 'npm i -D prettier' } },
        { id: 'style', description: 'Style', status: 'unverifiable' as const,
          detectors: [{ sensor: 'lint', status: 'unverifiable' as const, evidence: [{ kind: 'command' as const, status: 'custom' as const }] }],
          remedy: { summary: 'Declare evidence', command: 'awm sensors init' } },
    ] },
};

test('human output shows every non-green class, remedy and totals (R2.8)', () => {
    expect(renderCoverageHuman(report)).toBe([
        'Sensor coverage', 'Pack: js-ts', 'Registry: baseline', 'Overall: gaps', '',
        'missing formatting — Formatting', '  detector: format (missing)', '  remedy: Add formatter', '  command: npm i -D prettier',
        'unverifiable style — Style', '  detector: lint (unverifiable)', '  remedy: Declare evidence', '  command: awm sensors init', '',
        'Summary: 0 covered, 1 missing, 1 unverifiable', '',
    ].join('\n'));
});

test('json is the exact versioned envelope and ends in newline (R2.8, R2.14)', () => {
    expect(renderCoverageJson(report)).toBe(`${JSON.stringify(report, null, 2)}\n`);
});

test('keeps the R2 static shape when an optional empirical section is added (R2.14)', () => {
    const extended = { ...report, empirical: { status: 'no_evidence' } };
    const parsed = JSON.parse(renderCoverageJson(extended));
    expect(parsed.static).toEqual(report.static);
    expect(parsed.empirical).toEqual({ status: 'no_evidence' });
    expect(parsed.schemaVersion).toBe(1);
});

test('not_configured names the remedy and no_reference stays distinct (R2.6)', () => {
    const notConfigured = { schemaVersion: 1 as const, pack: null, registry: null, overall: 'inconclusive' as const,
        static: { status: 'inconclusive' as const, reason: 'not_configured' as const, classes: [] } };
    expect(renderCoverageHuman(notConfigured)).toContain('Run: awm sensors init');
    expect(renderCoverageHuman({ ...notConfigured, pack: 'legacy', registry: 'baseline', static: { ...notConfigured.static, reason: 'no_reference' as const } })).toContain('No coverage reference');
});
```

- [ ] **Step 2: Ejecutar render en rojo**

Run: `cd cli && npx jest tests/commands/sensors/coverage/render.test.ts --runInBand`

Expected: FAIL por módulo inexistente.

- [ ] **Step 3: Implementar renderizadores puros**

```ts
// cli/src/commands/sensors/coverage/render.ts
import type { CoverageEnvelope } from '.';

export function renderCoverageJson(report: CoverageEnvelope): string {
    if (!report || report.schemaVersion !== 1) throw new Error('renderCoverageJson: invalid report');
    return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderCoverageHuman(report: CoverageEnvelope): string {
    if (!report || report.schemaVersion !== 1) throw new Error('renderCoverageHuman: invalid report');
    if (report.static.reason === 'not_configured') return ['Sensor coverage', 'Overall: inconclusive', 'Reason: sensors are not configured', 'Run: awm sensors init', ''].join('\n');
    if (report.static.reason === 'no_reference') return ['Sensor coverage', `Pack: ${report.pack}`, `Registry: ${report.registry}`, 'Overall: inconclusive', `No coverage reference for pack '${report.pack}'`, ''].join('\n');
    const lines = ['Sensor coverage', `Pack: ${report.pack}`, `Registry: ${report.registry}`, `Overall: ${report.overall}`, ''];
    for (const item of report.static.classes.filter((entry) => entry.status !== 'covered')) {
        lines.push(`${item.status} ${item.id} — ${item.description}`);
        item.detectors.forEach((detector) => lines.push(`  detector: ${detector.sensor} (${detector.status})`));
        lines.push(`  remedy: ${item.remedy.summary}`, `  command: ${item.remedy.command}`);
    }
    const count = (status: 'covered' | 'missing' | 'unverifiable') => report.static.classes.filter((item) => item.status === status).length;
    lines.push('', `Summary: ${count('covered')} covered, ${count('missing')} missing, ${count('unverifiable')} unverifiable`, '');
    return lines.join('\n');
}
```

- [ ] **Step 4: Añadir los tests rojos de Commander y exit codes**

En `cli/tests/commands/sensors/index.test.ts`, mockear `./coverage` y `./coverage/render`, y añadir:

```ts
it('registers sensors coverage with --json and emits human output by default (R2.8)', async () => {
    const sensors = program.commands.find((command) => command.name() === 'sensors')!;
    const coverage = sensors.commands.find((command) => command.name() === 'coverage')!;
    expect(coverage.options.some((option) => option.long === '--json')).toBe(true);
    await program.parseAsync(['node', 'awm', 'sensors', 'coverage']);
    expect(renderCoverageHuman).toHaveBeenCalledWith(report);
});

it('emits JSON for --json and does not exit for gaps/inconclusive (R2.9)', async () => {
    for (const overall of ['gaps', 'inconclusive'] as const) {
        runCoverage.mockReturnValue({ ...report, overall, static: { ...report.static, status: overall } });
        await program.parseAsync(['node', 'awm', 'sensors', 'coverage', '--json']);
    }
    expect(processExit).not.toHaveBeenCalled();
});

it('prints an actionable contract error and exits 1 (R2.7)', async () => {
    runCoverage.mockImplementation(() => { throw new Error('Invalid coverage contract at pack.json: schemaVersion expected 1'); });
    await program.parseAsync(['node', 'awm', 'sensors', 'coverage']);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('schemaVersion'));
    expect(processExit).toHaveBeenCalledWith(1);
});
```

- [ ] **Step 5: Conectar el subcomando sin cambiar los comandos existentes**

Añadir imports y este bloque a `registerSensorsCommand` en `cli/src/commands/sensors/index.ts`:

```ts
import { runCoverage } from './coverage';
import { renderCoverageHuman, renderCoverageJson } from './coverage/render';

sensors
    .command('coverage')
    .description('report static gaps between configured sensors and the pack reference')
    .option('--json', 'emit the versioned machine-readable envelope')
    .action((opts: { json?: boolean }) => {
        try {
            const report = runCoverage(process.cwd());
            process.stdout.write(opts.json ? renderCoverageJson(report) : renderCoverageHuman(report));
        } catch (error) {
            log.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    });
```

- [ ] **Step 6: Documentar el contrato CLI**

Insertar antes de `awm sensors run` en `docs/cli-reference.md`:

```markdown
### `awm sensors coverage`

Compare the configured sensors with the static coverage reference owned by the selected sensor-pack. The command is diagnostic and read-only: it does not run sensors, install tools, edit `.awm/sensors.json`, or apply remedies.

```text
awm sensors coverage [--json]
```

Human output is the default. `--json` emits envelope `schemaVersion: 1` with stable `static` data; a future release may add optional `empirical` data without changing the meaning of existing fields.

Coverage gaps, unverifiable custom configuration, missing `.awm/sensors.json`, and packs without a reference are informative and exit `0`. Malformed/unreadable manifests, packs, or coverage contracts exit non-zero. `not_configured` recommends `awm sensors init`; `no_reference` is never reported as covered.
```

- [ ] **Step 7: Ejecutar wiring, render, regresión de comandos y build**

Run: `cd cli && npx jest tests/commands/sensors/coverage/render.test.ts tests/commands/sensors/index.test.ts --runInBand && npm run build`

Expected: PASS y `node dist/src/index.js sensors --help` lista `coverage`.

- [ ] **Step 8: Commit de superficie CLI**

```bash
git add cli/src/commands/sensors/coverage/render.ts cli/src/commands/sensors/index.ts cli/tests/commands/sensors/coverage/render.test.ts cli/tests/commands/sensors/index.test.ts docs/cli-reference.md
git commit -m "feat(sensors): expose static coverage report"
```

### Task 6: Aceptación reproducible, read-only y evidencia provider-neutral

_Requirements: RF-1.1, RF-1.4, RF-1.5, RNF-T.2, R2.6, R2.8, R2.9, R2.10, R2.12, R2.13, R2.14_

**Files:**
- Create: `cli/tests/fixtures/sensor-coverage/js-ts-gap/.awm/sensors.json`
- Create: `cli/tests/fixtures/sensor-coverage/js-ts-gap/package.json`
- Create: `cli/tests/fixtures/sensor-coverage/registry/sensor-packs/js-ts/pack.json`
- Create: `cli/tests/fixtures/sensor-coverage/legacy-pack/pack.json`
- Create: `cli/tests/integration/sensor-coverage.e2e.test.ts`
- Create: `cli/tests/integration/sensor-coverage-provider-evidence.test.ts`
- Create: `docs/research/r2/README.md`
- Create: `docs/research/r2/provider-run.mjs`
- Create: `docs/research/r2/evidence/.gitkeep`

**Skills:** `test-driven-development`

- [ ] **Step 1: Crear el fixture mínimo versionado del gap JS/TS**

```json
// cli/tests/fixtures/sensor-coverage/js-ts-gap/.awm/sensors.json
{
  "pack": "js-ts",
  "sensors": {
    "typecheck": { "cmd": "npx tsc --noEmit", "enabled": true },
    "lint": { "cmd": "npx eslint . --config eslint.config.awm.mjs --format json", "enabled": true },
    "test": { "cmd": "npm test --silent", "enabled": true },
    "security": { "cmd": "semgrep --config .semgrep.awm.yml --json .", "enabled": true }
  }
}
```

```json
// cli/tests/fixtures/sensor-coverage/js-ts-gap/package.json
{ "name": "r2-js-ts-gap", "private": true }
```

```json
// cli/tests/fixtures/sensor-coverage/legacy-pack/pack.json
{ "name": "legacy", "description": "Legacy pack without coverage", "detects": [], "sensors": {} }
```

```json
// cli/tests/fixtures/sensor-coverage/registry/sensor-packs/js-ts/pack.json
{
  "name": "js-ts",
  "sensors": {},
  "coverage": {
    "schemaVersion": 1,
    "classes": {
      "formatting": {
        "description": "Mechanical formatting consistency",
        "detectors": [{ "sensor": "format", "evidence": { "commandIncludes": ["prettier"] } }],
        "remedy": { "summary": "Add a formatter", "command": "npm install --save-dev prettier" }
      },
      "project-style-conventions": {
        "description": "Project-specific lint conventions",
        "detectors": [
          { "sensor": "lint", "evidence": { "commandIncludes": ["eslint", "--config"], "files": [{ "path": "eslint.config.js", "containsAll": [] }] } },
          { "sensor": "lint", "evidence": { "commandIncludes": ["eslint", "--config"], "files": [{ "path": "eslint.config.mjs", "containsAll": [] }] } },
          { "sensor": "lint", "evidence": { "commandIncludes": ["eslint", "--config"], "files": [{ "path": "eslint.config.cjs", "containsAll": [] }] } }
        ],
        "remedy": { "summary": "Add an ESLint project config", "command": "touch eslint.config.js" }
      }
    }
  }
}
```

- [ ] **Step 2: Escribir el E2E rojo con binario compilado y homes aislados**

```ts
// cli/tests/integration/sensor-coverage.e2e.test.ts
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFileSync, spawnSync } from 'child_process';

const cliDir = path.resolve(__dirname, '../..');
const bin = path.join(cliDir, 'dist/src/index.js');
const fixture = path.join(cliDir, 'tests/fixtures/sensor-coverage/js-ts-gap');
const registryFixture = path.join(cliDir, 'tests/fixtures/sensor-coverage/registry');
const hashTree = (root: string): string => {
    const hash = crypto.createHash('sha256');
    const walk = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).forEach((entry) => {
        const file = path.join(dir, entry.name); hash.update(path.relative(root, file));
        if (entry.isDirectory()) walk(file); else if (entry.isFile()) hash.update(fs.readFileSync(file)); else hash.update(`link:${fs.readlinkSync(file)}`);
    });
    walk(root); return hash.digest('hex');
};

beforeAll(() => { execFileSync('npm', ['run', 'build'], { cwd: cliDir, stdio: 'pipe' }); });

test('compiled CLI reports formatter/style gaps and changes no bytes (RF-1.1, RF-1.4)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-coverage-e2e-'));
    try {
        const project = path.join(tmp, 'project'); fs.cpSync(fixture, project, { recursive: true });
        const awmHome = path.join(tmp, 'awm-home');
        const registry = path.join(awmHome, 'registries', 'baseline');
        fs.mkdirSync(path.dirname(registry), { recursive: true });
        fs.cpSync(registryFixture, registry, { recursive: true });
        fs.writeFileSync(path.join(awmHome, 'registries.json'), JSON.stringify([{ name: 'baseline', remote: 'fixture' }]));
        const before = [hashTree(project), hashTree(awmHome)];
        const stdout = execFileSync(process.execPath, [bin, 'sensors', 'coverage', '--json'], {
            cwd: project, encoding: 'utf8', env: { ...process.env, AWM_HOME: awmHome, AWM_NO_UPDATE_CHECK: '1' },
        });
        const report = JSON.parse(stdout);
        expect(report.static.classes).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'formatting', status: 'missing' }),
            expect.objectContaining({ id: 'project-style-conventions', status: 'missing' }),
        ]));
        expect([hashTree(project), hashTree(awmHome)]).toEqual(before);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('informative states exit zero; malformed contract exits non-zero (R2.7, R2.9)', () => {
    const run = (mutatePack: (pack: Record<string, any>) => void) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-coverage-exit-'));
        const project = path.join(tmp, 'project'); fs.cpSync(fixture, project, { recursive: true });
        const awmHome = path.join(tmp, 'awm-home');
        const registry = path.join(awmHome, 'registries', 'baseline');
        fs.mkdirSync(path.dirname(registry), { recursive: true });
        fs.cpSync(registryFixture, registry, { recursive: true });
        fs.writeFileSync(path.join(awmHome, 'registries.json'), JSON.stringify([{ name: 'baseline', remote: 'fixture' }]));
        const packPath = path.join(registry, 'sensor-packs/js-ts/pack.json');
        const pack = JSON.parse(fs.readFileSync(packPath, 'utf8')); mutatePack(pack);
        fs.writeFileSync(packPath, JSON.stringify(pack));
        const result = spawnSync(process.execPath, [bin, 'sensors', 'coverage', '--json'], {
            cwd: project, encoding: 'utf8', env: { ...process.env, AWM_HOME: awmHome, AWM_NO_UPDATE_CHECK: '1' },
        });
        fs.rmSync(tmp, { recursive: true, force: true });
        return result;
    };
    const gaps = run(() => undefined);
    const noReference = run((pack) => { delete pack.coverage; });
    const malformed = run((pack) => { pack.coverage.schemaVersion = 2; });
    expect(gaps.status).toBe(0);
    expect(JSON.parse(gaps.stdout).overall).toBe('gaps');
    expect(noReference.status).toBe(0);
    expect(JSON.parse(noReference.stdout).static.reason).toBe('no_reference');
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain('schemaVersion expected 1');
});
```

- [ ] **Step 3: Ejecutar E2E rojo antes de que exista la referencia del registry**

Run: `cd cli && npx jest tests/integration/sensor-coverage.e2e.test.ts --runInBand`

Expected: FAIL por ausencia del comando/implementación R2 o por una aserción funcional; nunca por depender del checkout hermano.

- [ ] **Step 4: Añadir runner e integridad de evidencia provider**

```js
// docs/research/r2/provider-run.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [provider, projectArg = path.join(repoRoot, 'cli')] = process.argv.slice(2);
if (!['claude-code', 'codex'].includes(provider)) throw new Error('provider must be claude-code or codex');
const project = path.resolve(projectArg);
const cli = path.join(repoRoot, 'cli/dist/src/index.js');
const stdout = execFileSync(process.execPath, [cli, 'sensors', 'coverage', '--json'], { cwd: project, encoding: 'utf8', env: { ...process.env, AWM_NO_UPDATE_CHECK: '1' } });
const report = JSON.parse(stdout);
const evidence = {
  schema: 1, provider, result: 'pass', sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
  command: 'node cli/dist/src/index.js sensors coverage --json',
  reportSha256: crypto.createHash('sha256').update(stdout).digest('hex'),
  semanticContract: { schemaVersion: report.schemaVersion, overall: report.overall, staticReason: report.static.reason,
    classes: report.static.classes.map(({ id, status }) => ({ id, status })) },
};
const out = path.join(repoRoot, 'docs/research/r2/evidence', `${provider}.json`);
fs.writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(out);
```

```ts
// cli/tests/integration/sensor-coverage-provider-evidence.test.ts
import fs from 'fs';
import path from 'path';

const evidenceDir = path.resolve(__dirname, '../../../docs/research/r2/evidence');
test.each(['claude-code', 'codex'])('%s evidence is present, sanitized and semantically equivalent (RNF-T.2)', (provider) => {
    const file = path.join(evidenceDir, `${provider}.json`);
    expect(fs.existsSync(file)).toBe(true);
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(value).toMatchObject({ schema: 1, provider, result: 'pass' });
    expect(value.sourceHead).toMatch(/^[0-9a-f]{40}$/);
    expect(value.command).toContain('node cli/dist/src/index.js sensors coverage --json');
    expect(JSON.stringify(value)).not.toMatch(/\/home\/[^/"\s]+|\/Users\/[^/"\s]+|\b(?:token|secret|password|api[-_]?key)\b"?\s*[:=]/i);
});

test('Claude Code and Codex expose the same result contract (RNF-T.2)', () => {
    const read = (name: string) => JSON.parse(fs.readFileSync(path.join(evidenceDir, `${name}.json`), 'utf8')).semanticContract;
    expect(read('claude-code')).toEqual(read('codex'));
});
```

- [ ] **Step 5: Documentar procedencia y reproducción**

`docs/research/r2/README.md` debe registrar:

```markdown
# R2 static coverage acceptance

- Fixture hermético: `cli/tests/fixtures/sensor-coverage/js-ts-gap/`.
- Procedencia: forma sanitizada de `cli/.awm/sensors.json` en commit `1cbc7c8926680ae36510fc921c90b09182777f4f`; se retiraron comandos no necesarios y no se copió ningún contenido local/no rastreado.
- Hash: `sha256sum` de cada archivo, listado abajo y actualizado solamente cuando cambie el fixture deliberadamente.
- Reproducción hermética: `cd cli && npm run build && npx jest tests/integration/sensor-coverage.e2e.test.ts --runInBand`.
- Corrida real: `npm run build && node dist/src/index.js sensors coverage --json` desde `cli/`, nunca `awm` global.
- Evidencia provider: `node docs/research/r2/provider-run.mjs claude-code cli` y `node docs/research/r2/provider-run.mjs codex cli` desde dos sesiones reales sobre el mismo SHA.
- Premisa CA-1.1: el checkout real carece de sensor `format`; si el estado del repo cambia, la corrida real documenta el estado nuevo y el fixture hermético permanece como reproducción histórica.
```

- [ ] **Step 6: Completar fixture/runner, ejecutar aceptación y registrar evidencia real**

Run en la sesión Claude Code: `cd cli && npm run build && node ../docs/research/r2/provider-run.mjs claude-code .`

Run en la sesión Codex: `cd cli && npm run build && node ../docs/research/r2/provider-run.mjs codex .`

Expected: ambos JSON tienen el mismo `semanticContract`. Si una plataforma real no está disponible, no fabricar `result: pass`: registrar `partial` en README y dejar que el test de certificación permanezca dirigido solamente a evidencias `pass`; RNF-T.2 no se marca completo hasta obtener ambas.

- [ ] **Step 7: Ejecutar suite dirigida de R2 y confirmar read-only**

Run: `cd cli && npx jest tests/commands/sensors/coverage tests/integration/sensor-coverage.e2e.test.ts tests/integration/sensor-coverage-provider-evidence.test.ts --runInBand && npm run build`

Expected: PASS, hashes idénticos antes/después y cero rutas reales de home en evidencia.

- [ ] **Step 8: Commit de aceptación CLI**

```bash
git add cli/tests/fixtures/sensor-coverage cli/tests/integration/sensor-coverage.e2e.test.ts cli/tests/integration/sensor-coverage-provider-evidence.test.ts docs/research/r2
git commit -m "test(sensors): prove static coverage acceptance"
```

- [ ] **Step 9: Abrir y mergear el PR del consumidor antes del registry**

Verificar `git status --short`, confirmar que solo los templates AWM aplicables al stack quedaron versionados, push de `feat/issue-20-r2-sensor-coverage` y PR con `Closes` solamente si issue #20 se cierra con R2; de lo contrario usar `Refs #20` y mantener R3 abierto. Esperar CI verde y publicación del CLI compatible antes de comenzar el merge del registry.

### Task 7: Gate estructural de coverage en `awm-baseline-registry`

_Requirements: R2.1, R2.7, R2.11, R2.15, RNF-T.3_

**Files:**
- Create: `../awm-baseline-registry/tests/sensor-pack-coverage.test.mjs`

**Skills:** `test-driven-development`

- [ ] **Step 1: Crear una rama limpia del registry desde su remoto actualizado**

```bash
cd ../awm-baseline-registry
git fetch origin
git switch -c feat/issue-20-r2-coverage-contracts origin/main
git status --short --branch
```

Expected: rama basada en `ad61e5051cbb3f0b1a60e6ce10ca9f8f1fde75a9` o un `origin/main` posterior que ya contenga ese commit; árbol limpio.

- [ ] **Step 2: Escribir el validador rojo del contrato y catálogo exacto**

```js
// tests/sensor-pack-coverage.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = {
  generic: ['hardcoded-secrets'],
  'js-ts': ['dependency-boundaries', 'dynamic-code-execution', 'formatting', 'hardcoded-secrets', 'lint-errors', 'project-style-conventions', 'regression-tests', 'sql-string-construction', 'static-type-errors'],
  python: ['dynamic-code-execution', 'hardcoded-secrets', 'lint-errors', 'regression-tests', 'sql-string-construction', 'static-type-errors', 'subprocess-shell-injection', 'unsafe-deserialization'],
  shell: ['dynamic-code-execution', 'hardcoded-secrets', 'remote-code-pipe-to-shell', 'shell-lint-errors', 'unquoted-command-substitution'],
};
const id = /^[a-z][a-z0-9-]*$/;

function validateCoverage(packName, coverage) {
  assert.deepEqual(Object.keys(coverage).sort(), ['classes', 'schemaVersion'], `${packName}.coverage: campos desconocidos`);
  assert.equal(coverage.schemaVersion, 1, `${packName}.coverage.schemaVersion debe ser 1`);
  assert.ok(coverage.classes && typeof coverage.classes === 'object' && !Array.isArray(coverage.classes));
  assert.deepEqual(Object.keys(coverage.classes).sort(), expected[packName], `${packName}: catálogo de clases inesperado`);
  for (const [classId, value] of Object.entries(coverage.classes)) {
    assert.match(classId, id, `${packName}.${classId}: id inválido`);
    assert.deepEqual(Object.keys(value).sort(), ['description', 'detectors', 'remedy']);
    assert.ok(typeof value.description === 'string' && value.description.trim());
    assert.ok(Array.isArray(value.detectors) && value.detectors.length > 0);
    assert.deepEqual(Object.keys(value.remedy).sort(), ['command', 'summary']);
    assert.ok(value.remedy.summary.trim() && value.remedy.command.trim());
    const genericText = `${classId} ${value.description} ${value.remedy.summary}`.toLowerCase();
    assert.doesNotMatch(genericText, /agentic-workflow|kodria|agent-vps|r2-js-ts-gap/, `${packName}.${classId}: clase acoplada a proyecto`);
    for (const detector of value.detectors) {
      assert.deepEqual(Object.keys(detector).sort(), detector.evidence ? ['evidence', 'sensor'] : ['sensor']);
      assert.match(detector.sensor, id);
      if (!detector.evidence) continue;
      assert.ok(Object.keys(detector.evidence).every((key) => ['commandIncludes', 'files'].includes(key)));
      if (detector.evidence.commandIncludes) {
        assert.ok(detector.evidence.commandIncludes.length > 0);
        detector.evidence.commandIncludes.forEach((part) => assert.ok(typeof part === 'string' && part.trim()));
      }
      for (const file of detector.evidence.files ?? []) {
        assert.deepEqual(Object.keys(file).sort(), ['containsAll', 'path']);
        assert.ok(file.path && !path.isAbsolute(file.path) && !file.path.split(/[\\/]/).some((part) => ['', '.', '..'].includes(part)));
        assert.ok(Array.isArray(file.containsAll));
        file.containsAll.forEach((marker) => assert.ok(typeof marker === 'string' && marker.trim()));
      }
    }
  }
}

for (const packName of Object.keys(expected)) {
  const pack = JSON.parse(fs.readFileSync(path.join(root, 'sensor-packs', packName, 'pack.json'), 'utf8'));
  assert.ok(pack.coverage, `${packName}: falta coverage`);
  validateCoverage(packName, pack.coverage);
  assert.ok(!('mutation-testing' in pack.coverage.classes), `${packName}: mutation está fuera del baseline mientras enabled:false`);
}

console.log('sensor-pack-coverage: 4 packs / contrato v1 OK');
```

- [ ] **Step 3: Ejecutar el gate rojo**

Run: `node tests/sensor-pack-coverage.test.mjs`

Expected: FAIL con `generic: falta coverage`.

- [ ] **Step 4: Commit del gate rojo solo después de añadir un fixture interno mínimo**

No dejar `main` permanentemente rojo. Mantener el archivo sin commit hasta Task 8, donde los cuatro contratos lo vuelven verde; el commit de Task 8 incluye test + packs como una unidad atómica.

### Task 8: Contratos baseline de los cuatro packs

_Requirements: RF-1.1, R2.1, R2.2, R2.3, R2.4, R2.5, R2.5a, R2.5b, R2.10, R2.15, RNF-T.3_

**Files:**
- Modify: `../awm-baseline-registry/sensor-packs/generic/pack.json`
- Modify: `../awm-baseline-registry/sensor-packs/js-ts/pack.json`
- Modify: `../awm-baseline-registry/sensor-packs/python/pack.json`
- Modify: `../awm-baseline-registry/sensor-packs/shell/pack.json`
- Create: `../awm-baseline-registry/tests/sensor-pack-coverage.test.mjs`

**Skills:** `test-driven-development`

- [ ] **Step 1: Añadir `generic.coverage` con evidencia real del pack**

```json
"coverage": {
  "schemaVersion": 1,
  "classes": {
    "hardcoded-secrets": {
      "description": "Hardcoded credentials and secret values",
      "detectors": [{
        "sensor": "security",
        "evidence": {
          "commandIncludes": ["semgrep", ".semgrep.awm.yml"],
          "files": [{ "path": ".semgrep.awm.yml", "containsAll": ["awm-generic-no-hardcoded-secrets"] }]
        }
      }],
      "remedy": { "summary": "Enable a generic secret scanner", "command": "awm sensors init --pack generic" }
    }
  }
}
```

- [ ] **Step 2: Añadir `js-ts.coverage` según el mapa completo**

Cada fila se serializa como una entrada de `coverage.classes`; todos los fragments/markers son literales y todas las evidencias dentro de la fila son AND. Las seis filas de `project-style-conventions` son detectores OR independientes.

| Clase | Sensor | `commandIncludes` | Archivo → `containsAll` | Remedio |
|---|---|---|---|---|
| `static-type-errors` | `typecheck` | `tsc`, `--noEmit` | ninguno | `npm install --save-dev typescript` |
| `lint-errors` | `lint` | `eslint`, `--config`, `eslint.config.awm.mjs` | `eslint.config.awm.mjs` → `no-unreachable` | `awm sensors init --pack js-ts` |
| `project-style-conventions` | `lint` | `eslint`, `--config` | alternativa por `eslint.config.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`, cada una con `containsAll: []` | `Create an ESLint project config and re-run awm sensors init --pack js-ts` |
| `formatting` | `format` | `prettier` | ninguno | `npm install --save-dev prettier` |
| `dependency-boundaries` | `depcheck` | `depcruise`, `--config`, `.dep-cruiser.awm.js` | `.dep-cruiser.awm.js` → `forbidden` | `npm install --save-dev dependency-cruiser` |
| `regression-tests` | `test` | `npm test` | ninguno | `Add a deterministic npm test script` |
| `dynamic-code-execution` | `security` | `semgrep`, `.semgrep.awm.yml` | `.semgrep.awm.yml` → `awm-no-eval` | `awm sensors init --pack js-ts` |
| `hardcoded-secrets` | `security` | `semgrep`, `.semgrep.awm.yml` | `.semgrep.awm.yml` → `awm-no-hardcoded-secrets` | `awm sensors init --pack js-ts` |
| `sql-string-construction` | `security` | `semgrep`, `.semgrep.awm.yml` | `.semgrep.awm.yml` → `awm-no-sql-concat` | `awm sensors init --pack js-ts` |

Usar como forma exacta por clase:

```json
"static-type-errors": {
  "description": "Static type errors",
  "detectors": [{ "sensor": "typecheck", "evidence": { "commandIncludes": ["tsc", "--noEmit"] } }],
  "remedy": { "summary": "Enable TypeScript type checking", "command": "npm install --save-dev typescript" }
}
```

- [ ] **Step 3: Añadir `python.coverage` según el mapa completo**

| Clase | Sensor | `commandIncludes` | Archivo → marker | Remedio |
|---|---|---|---|---|
| `static-type-errors` | `typecheck` | `mypy` | ninguno | `python -m pip install mypy` |
| `lint-errors` | `lint` | `ruff`, `check` | ninguno | `python -m pip install ruff` |
| `regression-tests` | `test` | `pytest` | ninguno | `python -m pip install pytest` |
| `dynamic-code-execution` | `security` | `semgrep`, `.semgrep.awm.yml` | `.semgrep.awm.yml` → `awm-py-no-eval-exec` | `awm sensors init --pack python` |
| `subprocess-shell-injection` | `security` | `semgrep`, `.semgrep.awm.yml` | `.semgrep.awm.yml` → `awm-py-subprocess-shell-true` | `awm sensors init --pack python` |
| `sql-string-construction` | `security` | `semgrep`, `.semgrep.awm.yml` | `.semgrep.awm.yml` → `awm-py-no-sql-string-building` | `awm sensors init --pack python` |
| `unsafe-deserialization` | `security` | `semgrep`, `.semgrep.awm.yml` | `.semgrep.awm.yml` → `awm-py-unsafe-deserialization` | `awm sensors init --pack python` |
| `hardcoded-secrets` | `security` | `semgrep`, `.semgrep.awm.yml` | `.semgrep.awm.yml` → `awm-py-no-hardcoded-secrets` | `awm sensors init --pack python` |

- [ ] **Step 4: Añadir `shell.coverage` según el mapa completo**

| Clase | Sensor | `commandIncludes` | Archivo → marker | Remedio |
|---|---|---|---|---|
| `shell-lint-errors` | `lint` | `shellcheck`, `--format json` | ninguno | `Install ShellCheck and re-run awm sensors init --pack shell` |
| `dynamic-code-execution` | `security` | `semgrep`, `.semgrep.awm.yml` | `.semgrep.awm.yml` → `awm-sh-no-eval` | `awm sensors init --pack shell` |
| `remote-code-pipe-to-shell` | `security` | `semgrep`, `.semgrep.awm.yml` | `.semgrep.awm.yml` → `awm-sh-curl-pipe-shell` | `awm sensors init --pack shell` |
| `unquoted-command-substitution` | `security` | `semgrep`, `.semgrep.awm.yml` | `.semgrep.awm.yml` → `awm-sh-unquoted-command-substitution` | `awm sensors init --pack shell` |
| `hardcoded-secrets` | `security` | `semgrep`, `.semgrep.awm.yml` | `.semgrep.awm.yml` → `awm-sh-no-hardcoded-secrets` | `awm sensors init --pack shell` |

- [ ] **Step 5: Ejecutar el gate estructural y el shape gate existente**

Run: `node tests/sensor-pack-coverage.test.mjs && node tests/sensor-pack-shape.test.mjs`

Expected: `sensor-pack-coverage: 4 packs / contrato v1 OK` y `sensor-pack-shape: 4 packs ... OK`.

- [ ] **Step 6: Probar una mutación semántica antes del commit**

Cambiar temporalmente la descripción de `hardcoded-secrets` a `Secrets in agentic-workflow`; el gate debe fallar por acoplamiento a proyecto. Restaurar y confirmar PASS.

- [ ] **Step 7: Commit atómico de gate + cuatro contratos**

```bash
git add tests/sensor-pack-coverage.test.mjs sensor-packs/generic/pack.json sensor-packs/js-ts/pack.json sensor-packs/python/pack.json sensor-packs/shell/pack.json
git commit -m "feat(sensors): declare baseline coverage contracts"
```

### Task 9: Self-test por mutaciones, CI y versión del registry

_Requirements: R2.1, R2.7, R2.11, R2.15, RNF-T.3_

**Files:**
- Create: `../awm-baseline-registry/tests/sensor-pack-coverage-mutations.test.mjs`
- Modify: `../awm-baseline-registry/.github/workflows/validate.yml`
- Modify: `../awm-baseline-registry/.github/workflows/auto-tag.yml`
- Modify: `../awm-baseline-registry/catalog.json`
- Modify: `../awm-baseline-registry/bundles/dev/bundle.json`
- Modify: `../awm-baseline-registry/CHANGELOG.md`

**Skills:** `test-driven-development`

- [ ] **Step 1: Extraer el validador a modo importable/CLI**

Mover `validateCoverage` y `validateRegistryCoverage(root)` a `tests/support/sensor-pack-coverage-validator.mjs`; `tests/sensor-pack-coverage.test.mjs` lo importa y ejecuta contra el checkout real. El módulo exporta funciones y solo imprime cuando `import.meta.url === pathToFileURL(process.argv[1]).href`.

```js
export function validateRegistryCoverage(root) {
  if (typeof root !== 'string' || root.length === 0) throw new Error('root must be a non-empty string');
  for (const packName of Object.keys(expected)) {
    const pack = JSON.parse(fs.readFileSync(path.join(root, 'sensor-packs', packName, 'pack.json'), 'utf8'));
    validateCoverage(packName, pack.coverage);
  }
}
```

- [ ] **Step 2: Escribir el self-test de mutaciones**

```js
// tests/sensor-pack-coverage-mutations.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRegistryCoverage } from './support/sensor-pack-coverage-validator.mjs';

const source = path.resolve(import.meta.dirname, '..');
const mutations = [
  ['future schema', /schemaVersion/, (pack) => { pack.coverage.schemaVersion = 2; }],
  ['unknown field', /campos desconocidos/, (pack) => { pack.coverage.clases = pack.coverage.classes; }],
  ['hostile path', /path/, (pack) => { pack.coverage.classes['hardcoded-secrets'].detectors[0].evidence.files[0].path = '../outside'; }],
  ['empty detectors', /detectors/, (pack) => { pack.coverage.classes['hardcoded-secrets'].detectors = []; }],
  ['project-specific class', /acoplada a proyecto/, (pack) => { pack.coverage.classes['hardcoded-secrets'].description = 'Secrets in agentic-workflow'; }],
  ['missing marker', /marker/, (pack) => { pack.coverage.classes['hardcoded-secrets'].detectors[0].evidence.files[0].containsAll[0] = 'marker-that-does-not-exist'; }],
];

for (const [name, expected, mutate] of mutations) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awm-coverage-mutation-'));
  try {
    fs.cpSync(source, tmp, { recursive: true, filter: (entry) => !entry.includes(`${path.sep}.git`) });
    const file = path.join(tmp, 'sensor-packs/generic/pack.json');
    const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
    mutate(pack); fs.writeFileSync(file, `${JSON.stringify(pack, null, 2)}\n`);
    assert.throws(() => validateRegistryCoverage(tmp), expected, name);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
console.log(`sensor-pack-coverage-mutations: ${mutations.length} mutations rejected`);
```

El validador productivo debe verificar además que todo marker declarado existe literalmente en el archivo del propio pack. Para `project-style-conventions`, donde el archivo esperado pertenece al proyecto consumidor y no al pack, declarar `containsAll: []` y no exigir existencia en registry; para archivos que sí existen junto al pack (`.semgrep.awm.yml`, `.dep-cruiser.awm.js`, `eslint.config.awm.mjs`), el test comprueba marker y existencia.

- [ ] **Step 3: Ejecutar el self-test rojo y corregir el validador hasta que cada mutación dispare**

Run: `node tests/sensor-pack-coverage-mutations.test.mjs`

Expected antes de endurecer: al menos `missing marker` no lanza. Expected final: `6 mutations rejected`.

- [ ] **Step 4: Añadir ambos comandos a los dos workflows**

En `.github/workflows/validate.yml` y dentro de `Verify registry before tagging` en `.github/workflows/auto-tag.yml`, después de `sensor-pack-shape`:

```yaml
      - run: node tests/sensor-pack-coverage.test.mjs
      - run: node tests/sensor-pack-coverage-mutations.test.mjs
```

Conservar la indentación propia de cada bloque: `auto-tag.yml` usa un `run: |`, por lo que allí se añaden como líneas `node ...`, no como nuevos items YAML.

- [ ] **Step 5: Bump coordinado del bundle dev y changelog**

Cambiar exactamente `2.9.0` → `2.10.0` en `catalog.json` y `bundles/dev/bundle.json`. Añadir al inicio de `CHANGELOG.md`:

```markdown
## dev 2.10.0 — 2026-08-11

### Added
- Contrato `coverage.schemaVersion: 1` en los packs `generic`, `js-ts`, `python` y `shell`, con clases genéricas, detectores literales y remedios read-only consumidos por `awm sensors coverage`.
- Gates `sensor-pack-coverage` y `sensor-pack-coverage-mutations`: validan forma, catálogo, paths, markers y desacoplamiento de proyectos antes del tag automático.

### Nota de versión
Bundle `dev` 2.9.0 → 2.10.0 (minor): capacidad aditiva. Los sensor-packs siguen siendo contenido top-level entregado por el tag del registry; no se modificó ninguna skill, por lo que no corresponde bump de frontmatter de skills.
```

- [ ] **Step 6: Ejecutar el gate completo del registry**

Run:

```bash
node scripts/validate-portability.mjs
node tests/validate-portability.test.mjs
node tests/codex-session-start.test.mjs
node tests/session-start.test.mjs
node tests/sensor-pack-eslint.test.mjs
node tests/sensor-pack-shape.test.mjs
node tests/sensor-pack-coverage.test.mjs
node tests/sensor-pack-coverage-mutations.test.mjs
```

Expected: todos exit `0`; los dos nuevos imprimen `4 packs / contrato v1 OK` y `6 mutations rejected`.

- [ ] **Step 7: Commit de gate, CI y versión**

```bash
git add tests/support/sensor-pack-coverage-validator.mjs tests/sensor-pack-coverage.test.mjs tests/sensor-pack-coverage-mutations.test.mjs .github/workflows/validate.yml .github/workflows/auto-tag.yml catalog.json bundles/dev/bundle.json CHANGELOG.md
git commit -m "test(sensors): gate baseline coverage metadata"
```

- [ ] **Step 8: Abrir PR del registry después de confirmar el consumidor publicado**

Push de `feat/issue-20-r2-coverage-contracts`, PR con `Refs Kodria/agentic-workflow#20`, CI verde y merge con conventional commit `feat(sensors): ...` para que `auto-tag.yml` derive bump minor. No crear tag manual.

### Task 10: Reconciliación cruzada, regresión completa y baton hacia R3

_Requirements: RF-1.1, RF-1.4, RF-1.5, RNF-T.2, RNF-T.3, R2.1, R2.2, R2.3, R2.4, R2.5, R2.5a, R2.5b, R2.6, R2.7, R2.8, R2.9, R2.10, R2.11, R2.12, R2.13, R2.14, R2.15_

**Files:**
- Modify: `docs/plans/2026-08-11-r2-static-sensor-coverage-plan.md` (checkmarks/markers solamente durante ejecución)
- Modify: `docs/plans/2026-07-30-sdd-cycle-optimization-brief.md` (estado R2 y baton R3, solo si el formato existente ya registra releases)
- Modify: issue `Kodria/agentic-workflow#20` (comentario de evidencia; mantener abierto para R3)

**Skills:** `verification-before-completion`, `requesting-code-review`, `post-implementation-qa`, `harness-retro`, `finishing-a-development-branch`

- [ ] **Step 1: Verificar primero el estado y scope de ambos repos**

Run:

```bash
git status --short --branch
git diff origin/main...HEAD --check
git -C ../awm-baseline-registry status --short --branch
git -C ../awm-baseline-registry diff origin/main...HEAD --check
```

Expected: solamente archivos R2 y del harness validado en commits/diff; `eslint.config.awm.cjs` y `tsconfig.awm.json` permanecen ausentes, mientras `.dep-cruiser.awm.js` y su baseline quedan versionados.

- [ ] **Step 2: Ejecutar la suite completa y build de la CLI**

Run: `cd cli && npm test && npm run build`

Expected: PASS y `dist/src/index.js` actualizado por build, sin añadir `dist/` al commit si el repo no lo trackea.

- [ ] **Step 3: Ejecutar el gate real de sensores con el CLI compilado local**

Run desde `cli/`: `node dist/src/index.js sensors run`

Expected: `overall: "pass"`. Nunca sustituir este comando por `awm sensors run` global.

- [ ] **Step 4: Ejecutar la aceptación coverage contra CLI + registry finales**

Con `AWM_HOME` temporal que contenga el registry final:

```bash
node dist/src/index.js sensors coverage --json
node dist/src/index.js sensors coverage
```

Expected: ambos exit `0`, JSON parseable, vista humana coherente, `pack: js-ts`, registry fuente correcto, clases ordenadas, y los gaps reales conservados sin escribir archivos.

- [ ] **Step 5: Ejecutar otra vez el gate completo del registry desde su rama final**

Run: los ocho comandos enumerados en Task 9 Step 6.

Expected: todos exit `0` sobre el commit que se enviará al PR.

- [ ] **Step 6: Solicitar review y ejecutar QA terminal**

Invocar `requesting-code-review`; corregir cada hallazgo con test discriminante rojo/verde. Luego invocar `post-implementation-qa`, cerrar todos los hallazgos, ejecutar `harness-retro` y no avanzar a `finishing-a-development-branch` hasta que el plan contenga `<!-- awm-qa-complete -->` y `<!-- awm-retro-complete -->`.

- [ ] **Step 7: Publicar evidencia en issue #20 y dejar explícito el baton R3**

Obtener primero las URLs reales y abortar si alguna está vacía:

```bash
CLI_PR_URL=$(gh pr view feat/issue-20-r2-sensor-coverage --json url --jq .url)
REGISTRY_PR_URL=$(gh pr view feat/issue-20-r2-coverage-contracts --repo Kodria/awm-baseline-registry --json url --jq .url)
test -n "$CLI_PR_URL" && test -n "$REGISTRY_PR_URL"
```

Publicar el comentario construyéndolo desde esas variables, de modo que no pueda viajar un enlace provisional:

```bash
gh issue comment 20 --repo Kodria/agentic-workflow --body "R2 complete:
- CLI PR: $CLI_PR_URL
- Registry PR/tag: $REGISTRY_PR_URL
- Contract: coverage.schemaVersion 1
- Acceptance: npm test, local compiled sensors run, static coverage E2E, registry mutation gate
- Provider evidence: Claude Code + Codex semantic envelopes match

Issue remains open for R3: add optional top-level empirical using the stable class IDs introduced by R2; do not change existing R2 field semantics."
```

## Matriz de trazabilidad

| Req | Task(s) | Test(s)/evidencia específica |
|---|---|---|
| RF-1.1 | T2, T4, T5, T6, T8, T10 | `evaluate.test.ts` tabla OR/AND; `index.test.ts` observa todos los detectores; `sensor-coverage.e2e` afirma `formatting`/`project-style-conventions` |
| RF-1.4 | T3, T4, T6, T10 | `evidence.test.ts` no filtra contenido; E2E compara hash de proyecto y AWM_HOME antes/después |
| RF-1.5 | T4, T6, T10 | `resolve.test.ts`/`index.test.ts` afirman `inconclusive/no_reference`, no `covered` |
| RNF-T.2 | T5, T6, T10 | `sensor-coverage-provider-evidence.test.ts` compara envelopes semánticos reales Claude Code/Codex |
| RNF-T.3 | T7, T8, T9, T10 | gate registry rechaza nombres de proyectos; catálogo exacto de clases genéricas |
| R2.1 | T1, T7, T8, T9 | `contract.test.ts` acepta v1; `sensor-pack-coverage.test.mjs` valida `coverage/classes/remedy` |
| R2.2 | T2, T3, T8 | `evaluate.test.ts` prueba OR y mismo sensor con índices; `evidence.test.ts` prueba AND |
| R2.3 | T2, T3, T8 | `evidence.test.ts` distingue `missing` y `disabled` |
| R2.4 | T2, T3, T8 | `evidence.test.ts` prueba archivo y marker ausentes como `ineffective` |
| R2.5 | T2, T3, T8 | `evidence.test.ts` prueba comando custom como `unverifiable` |
| R2.5a | T2, T3, T8 | tests symlink, oversize y read error producen `unverifiable` |
| R2.5b | T2, T8 | tabla `[unverifiable, missing]` y precedencia global gaps |
| R2.6 | T4, T5, T6 | `not_configured` cortocircuita registries, recomienda init y CLI exit `0` |
| R2.7 | T1, T4, T5, T9 | corpus inválido, JSON bounded/malformed, Commander exit `1`, seis mutaciones registry |
| R2.8 | T5, T6 | snapshots exactos humano/JSON y E2E del binario compilado |
| R2.9 | T3, T4, T5, T6 | wiring prueba exit `0` para gaps/inconclusive y `1` para contrato roto |
| R2.10 | T2, T5, T6 | determinismo por orden de IDs y equivalencia de outputs repetidos |
| R2.11 | T1, T3, T4, T7, T9 | corpus traversal, `lstat`, no symlink, 1 MiB, literals, mutaciones hostiles |
| R2.12 | T4, T6 | fixture multi-registry prueba primer registry con pack exacto y nombre reportado |
| R2.13 | T1, T4, T6 | pack viejo sin `coverage` retorna `no_reference`; regresión de comandos existentes |
| R2.14 | T2, T4, T5, T6 | test JSON exacto conserva `static`, no emite `empirical`, acepta futura propiedad opcional |
| R2.15 | T7, T8, T9, T10 | gate exige cuatro catálogos exactos y ausencia de `mutation-testing` |

## Analyze gate

- Forward coverage: cada requisito del diseño R2 aparece al menos en una tarea y una prueba/evidencia que verifica su afirmación concreta.
- Backward coverage: T1–T10 se anclan exclusivamente a requisitos R2; la coordinación de PRs y versión implementa la entrega definida por el diseño, no una feature adicional.
- La prueba provider no se satisface por mencionar proveedores: compara dos JSON reales sobre el mismo contrato.
- La prueba read-only no se satisface por inspección manual: compara hashes del proyecto y `AWM_HOME` antes/después.
- La seguridad de symlinks no se satisface por un path nominal: la mutación `lstatSync` → `statSync` debe volver rojo el caso.
- El gate del registry no se satisface por un test permanentemente rojo: test + cuatro contratos se comitean juntos en T8.

## Handoff de ejecución

La opción recomendada es `subagent-driven-development`: una tarea por implementador fresco y review de spec/calidad entre tareas. La alternativa es `executing-plans` inline por lotes con checkpoints. En ambos casos TDD, QA, retro y cierre de rama son obligatorios; el modo de este plan es interactivo.

### Estado del gate al redactar el plan (2026-08-11)

- `awm preflight` desde `cli/`: `ready` (manifest `js-ts`, 5/6 sensores activos, tools y baseline presentes).
- `awm context-budget`: límites iniciales fijados en 69 KB para la raíz y 8 KB para `cli/`; los JSON viven bajo `.awm/` y deben añadirse deliberadamente con `git add -f` porque el repo ignora ese directorio.
- `npm run build`: PASS después de sincronizar `node_modules` con el lockfile; faltaba localmente `@types/js-yaml@4.0.9`, aunque ya estaba declarado.
- `npm test --silent`: PASS, 208/208 suites y 2141/2141 tests en 181.621 s. Jest usa ahora un tmpdir propio, no hereda `CODEX_HOME`, las fixtures que requieren proyecto declaran su marker y los probes de binarios externos se controlan explícitamente.
- `node dist/src/index.js sensors run`: **PASS**. `typecheck`, `lint`, `security` y `test` pasan; `mutation` permanece deshabilitado por diseño. El sensor de tests tiene un presupuesto de 300 s, por encima de los 181.621 s observados y con margen para CI.
- Regresiones focalizadas: PASS, 9 suites y 135 tests; no reaparece `/tmp/.awm` tras la ejecución.

El gate de `verification-before-completion` queda satisfecho y el plan está listo para versionarse junto con los context-budget pins. La ejecución de R2 sigue requiriendo la elección explícita del modo de ejecución indicada en el handoff; este arreglo solo elimina el bloqueo del harness.
