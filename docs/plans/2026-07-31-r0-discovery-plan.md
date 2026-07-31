# R0 Discovery — Probe Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`
> (recommended) or `executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir y ejecutar la Fase A del kit de sondas de R0 (matriz de capacidades, protocolo de agente, análisis sandbox-only) y dejar la Fase B lista para el dueño, según `docs/plans/2026-07-31-r0-discovery-design.md` (R1–R10).

**Architecture:** Kit autocontenido bajo `docs/research/r0/` — sondas mecánicas en Node puro (clase 1), protocolo de agente con verdad en archivos (clase 2), consolidador que regenera la matriz desde `evidence/*.json`. Fase A corre aquí (primera fila de la matriz); Fase B es del dueño vía esta rama; Fase C (informe) queda condicionada a la evidencia de B.

**Tech Stack:** Node ≥ 20 (solo built-ins), git. Sin dependencias nuevas, sin tocar `cli/` ni configs.

**Modo de ejecución:** desatendido

> Mandato de ejecución desatendida: ejecución completa sin pausas de check-in
> entre tareas, ni de confirmación entre fases (development-process rutea
> automáticamente y subagent-driven-development no pregunta si continuar con
> el cierre). harness-retro triagea con criterio propio del agente (solo valor
> real, recurrente o sistémico — descarta el resto sin preguntar).
> post-implementation-qa corrige TODOS los hallazgos que surjan, no solo algunos.
> finishing-a-development-branch crea el PR directamente (opción "push + PR"),
> sin presentar el menú de 4 opciones.

---

## Notas de ejecución

- **Requirements R1–R10** = los del design doc `2026-07-31-r0-discovery-design.md` (no confundir con los `RF-x.y` del brief).
- **Ejecutor: controlador inline** — las Tasks 7–9 ejercitan primitivas del propio harness (despacho paralelo, fin de turno, override de modelo) que un subagente no puede ejercitar con fidelidad (no puede terminar el turno de la sesión, y su capacidad de despacho anidado no es representativa). Las ejecuta el controlador; el spec-review posterior audita los **artefactos**, que son la verdad (R4), no el relato.
- **Fase C condicionada** — las Tasks 12–13 verifican primero que exista evidencia de Fase B (`evidence/mech-codex-*` y `mech-opencode-*`); si no existe, reportan BLOCKED y el ciclo se detiene ahí legítimamente (es el corte natural: la Fase B es del dueño). La Task 14 (validación del dueño, R9) es autoridad externa: siempre interactiva, el modo desatendido no la salta.
- **Verificación del kit**: proporcional por diseño (ver §Verificación del design doc) — smoke real + caso de conflicto fabricado para el consolidador; sin suite Jest (el kit es tooling descartable de descubrimiento, no producto; acoplarlo a `cli/tests/` violaría esa frontera).

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `docs/research/r0/probes/run.mjs` | Entrypoint: valida args, corre sondas mecánicas, escribe un JSON estampado por corrida |
| `docs/research/r0/probes/lib/fingerprint.mjs` | Huella del entorno (OS, node, fecha) |
| `docs/research/r0/probes/lib/detached.mjs` | Sonda: supervivencia de proceso detached a la muerte de su padre |
| `docs/research/r0/probes/lib/rename.mjs` | Sonda: rename-replace íntegro en el filesystem de `evidence/` |
| `docs/research/r0/probes/lib/cli-inspect.mjs` | Sonda: versión + superficie de flags de `claude`/`codex`/`opencode`, sin auth |
| `docs/research/r0/probes/consolidate.mjs` | `evidence/*.json` → `capability-matrix.md` (generada, con detección de conflictos) |
| `docs/research/r0/AGENT-PROTOCOL.md` | Ejercicios P1–P5 con verdad en archivos + formulario JSON |
| `docs/research/r0/RUNBOOK.md` | Instrucciones Fase B del dueño |
| `docs/research/r0/evidence/` | JSONs de corridas + artefactos P1–P5 |
| `docs/research/r0/analysis/*.md` | Análisis sandbox-only (R6) — insumo directo de `report.md` en Fase C |
| `docs/research/r0/capability-matrix.md` | Generada por el consolidador — nunca a mano |
| `docs/research/r0/report.md` | Fase C |

---

### Task 1: Esqueleto del kit + entrypoint con validación de args + fingerprint

_Requirements: R1, R2, R2.1, R2.2_

**Files:**
- Create: `docs/research/r0/probes/run.mjs`
- Create: `docs/research/r0/probes/lib/fingerprint.mjs`
- Create: `docs/research/r0/evidence/.gitkeep`

- [ ] **Step 1: Crear `docs/research/r0/probes/lib/fingerprint.mjs`**

```js
// Huella del entorno de la corrida. Sin hostname ni usuario: la evidencia se
// commitea al repo y la constraint de privacidad del brief prohíbe persistir
// identificadores innecesarios.
import os from 'node:os';

export function fingerprint() {
  return {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    node: process.version,
    date: new Date().toISOString(),
  };
}
```

- [ ] **Step 2: Crear `docs/research/r0/probes/run.mjs`**

```js
#!/usr/bin/env node
// Entrypoint de las sondas mecánicas de R0 (design doc R2).
// Uso: node run.mjs --provider <p> --env <etiqueta> [--evidence-dir <dir>]
// Un JSON estampado por corrida; corridas repetidas acumulan (R2.2).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint } from './lib/fingerprint.mjs';
import { probeDetachedSurvival } from './lib/detached.mjs';
import { probeRenameReplace } from './lib/rename.mjs';
import { probeCliInspection } from './lib/cli-inspect.mjs';

// CONSTITUTION: todo arg CLI que espera valor valida que el siguiente token
// exista y no empiece con `--` — fallar fuerte, nunca silenciar.
function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) {
    throw new Error(`${flag} requiere un valor`);
  }
  return v;
}

function main() {
  const argv = process.argv.slice(2);
  let provider, envLabel, evidenceDir;
  try {
    provider = argValue(argv, '--provider');
    envLabel = argValue(argv, '--env');
    evidenceDir = argValue(argv, '--evidence-dir');
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
  if (!provider || !envLabel) {
    process.stderr.write(
      'Uso: node run.mjs --provider <claude-code|codex|opencode> --env <etiqueta> [--evidence-dir <dir>]\n',
    );
    process.exit(1);
  }
  const dir = evidenceDir
    ? path.resolve(evidenceDir)
    : fileURLToPath(new URL('../evidence/', import.meta.url));
  fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const ctx = { evidenceDir: dir, stamp };

  Promise.resolve()
    .then(async () => ({
      schema: 1,
      kind: 'mech',
      provider,
      environment: envLabel,
      ...fingerprint(),
      probes: {
        detachedSurvival: await probeDetachedSurvival(ctx),
        renameReplace: probeRenameReplace(ctx),
        cliInspection: probeCliInspection(ctx),
      },
    }))
    .then((result) => {
      // R2.2: nombre estampado — corridas repetidas acumulan, jamás sobrescriben.
      const out = path.join(dir, `mech-${provider}-${envLabel}-${stamp}.json`);
      fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
      process.stdout.write(`${out}\n`);
    });
}

main();
```

- [ ] **Step 3: Crear `docs/research/r0/evidence/.gitkeep`** (archivo vacío).

- [ ] **Step 4: Stubs temporales de las sondas** — `run.mjs` importa las tres sondas de la Task 2, que aún no existen; para poder verificar el entrypoint ya, crear los tres archivos con stubs de export nombrado correcto (la Task 2 los reemplaza):

`docs/research/r0/probes/lib/detached.mjs` (stub temporal):
```js
export async function probeDetachedSurvival() { return { state: 'no-verificable-aquí', detail: 'stub' }; }
```
`docs/research/r0/probes/lib/rename.mjs` (stub temporal):
```js
export function probeRenameReplace() { return { state: 'no-verificable-aquí', detail: 'stub' }; }
```
`docs/research/r0/probes/lib/cli-inspect.mjs` (stub temporal):
```js
export function probeCliInspection() { return { state: 'no-verificable-aquí', detail: 'stub' }; }
```

- [ ] **Step 5: Verificar guard y acumulación**

Run: `node docs/research/r0/probes/run.mjs --provider` → Expected: `--provider requiere un valor`, exit 1.
Run: `node docs/research/r0/probes/run.mjs` → Expected: línea de `Uso: ...`, exit 1.
Run (dos veces): `node docs/research/r0/probes/run.mjs --provider claude-code --env smoke`
Expected: dos archivos distintos `mech-claude-code-smoke-*.json` bajo `docs/research/r0/evidence/` (R2.2). Borrar ambos al final del step (`rm docs/research/r0/evidence/mech-claude-code-smoke-*.json`) — eran humo, no evidencia real.

- [ ] **Step 6: Commit**

```bash
git add docs/research/r0/
git commit -m "feat(r0): probe kit skeleton — validated entrypoint, stamped runs"
```

---

### Task 2: Las tres sondas mecánicas reales

_Requirements: R3, R3.1_

**Files:**
- Modify: `docs/research/r0/probes/lib/detached.mjs` (reemplaza el stub)
- Modify: `docs/research/r0/probes/lib/rename.mjs` (reemplaza el stub)
- Modify: `docs/research/r0/probes/lib/cli-inspect.mjs` (reemplaza el stub)

- [ ] **Step 1: `detached.mjs` — supervivencia a la muerte del padre**

La cadena: `run.mjs` (abuelo, vivo) lanza un intermediario que lanza un writer
detached y muere de inmediato; si el writer sigue escribiendo heartbeats
después de la muerte del intermediario, sobrevivió a su padre. (La
supervivencia al fin de **turno/sesión** es P3 del protocolo de agente — otra
clase de hecho, no de esta sonda.)

```js
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WRITER = `
const fs = require('fs');
const f = process.argv[2];
const end = Date.now() + 4000;
(function tick() {
  fs.appendFileSync(f, Date.now() + '\\n');
  if (Date.now() < end) setTimeout(tick, 200);
})();
`;

const MID = `
const { spawn } = require('child_process');
const fs = require('fs');
const [writerPath, hbFile, exitFile] = process.argv.slice(2);
const c = spawn(process.execPath, [writerPath, hbFile], { detached: true, stdio: 'ignore' });
c.unref();
fs.writeFileSync(exitFile, String(Date.now()));
`;

export async function probeDetachedSurvival(ctx) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r0-detached-'));
  const writerPath = path.join(tmp, 'writer.cjs');
  const midPath = path.join(tmp, 'mid.cjs');
  const hbFile = path.join(ctx.evidenceDir, `detached-heartbeats-${ctx.stamp}.log`);
  const exitFile = path.join(tmp, 'mid-exit.txt');
  fs.writeFileSync(writerPath, WRITER);
  fs.writeFileSync(midPath, MID);

  const mid = spawn(process.execPath, [midPath, writerPath, hbFile, exitFile], { stdio: 'ignore' });
  await new Promise((res) => mid.on('exit', res));
  const midExit = Number(fs.readFileSync(exitFile, 'utf-8'));

  await new Promise((res) => setTimeout(res, 2500));
  fs.rmSync(tmp, { recursive: true, force: true });

  if (!fs.existsSync(hbFile)) {
    return { state: 'no-soportado', detail: 'el writer detached nunca escribió', artifacts: [] };
  }
  const beats = fs.readFileSync(hbFile, 'utf-8').trim().split('\n').map(Number);
  const after = beats.filter((t) => t > midExit + 300).length;
  return {
    state: after >= 3 ? 'soportado' : 'no-soportado',
    detail: `${after} heartbeats posteriores a la muerte del padre (umbral: 3)`,
    artifacts: [path.basename(hbFile)],
  };
}
```

- [ ] **Step 2: `rename.mjs` — rename-replace íntegro en el fs de evidence/**

```js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function probeRenameReplace(ctx) {
  const src = path.join(ctx.evidenceDir, `.rename-src-${ctx.stamp}`);
  const dst = path.join(ctx.evidenceDir, `.rename-dst-${ctx.stamp}`);
  try {
    const payload = crypto.randomBytes(1024 * 1024); // 1 MiB
    fs.writeFileSync(src, payload);
    fs.writeFileSync(dst, 'contenido viejo que debe desaparecer entero');
    fs.renameSync(src, dst);
    const back = fs.readFileSync(dst);
    const intact = back.length === payload.length && back.equals(payload);
    return {
      state: intact ? 'soportado' : 'degradado',
      detail: intact
        ? 'rename-replace entrega el contenido nuevo íntegro en el fs de evidence/'
        : 'contenido parcial tras rename — NO usar rename como commit atómico aquí',
      artifacts: [],
    };
  } catch (e) {
    return { state: 'no-soportado', detail: `rename falló: ${e.message}`, artifacts: [] };
  } finally {
    fs.rmSync(src, { force: true });
    fs.rmSync(dst, { force: true });
  }
}
```

- [ ] **Step 3: `cli-inspect.mjs` — versión y flags sin auth (R3.1: ausente ⇒ seguir)**

```js
import { execFileSync } from 'node:child_process';

// AGENTS.md: execFileSync con array de args — nunca execSync con string.
// El timeout de 10s es pragmático para `--version`/`--help` (consulta puntual,
// no un job de verificación — la constraint "sin timeout terminal" del brief
// aplica a verificaciones, no a esta inspección); si dispara, se REGISTRA como
// no-verificable, no se interpreta como fallo del binario.
const LIMIT = 8192; // retención acotada (constraint de privacidad del brief)

function inspectOne(bin) {
  const out = { present: false };
  for (const flag of ['--version', '--help']) {
    try {
      const raw = execFileSync(bin, [flag], { encoding: 'utf-8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
      out.present = true;
      out[flag === '--version' ? 'version' : 'help'] = raw.slice(0, LIMIT);
    } catch (e) {
      if (e.code === 'ENOENT') {
        return { present: false, state: 'no-verificable-aquí', detail: 'binario ausente' };
      }
      out[flag] = `no-verificable-aquí: ${e.code ?? e.message}`.slice(0, 200);
    }
  }
  if (out.help) {
    out.modelFlagHints = out.help
      .split('\n')
      .filter((l) => /--?model\b|--?m\b|effort/i.test(l))
      .slice(0, 10);
  }
  out.state = out.present ? 'soportado' : 'no-verificable-aquí';
  return out;
}

export function probeCliInspection() {
  return {
    claude: inspectOne('claude'),
    codex: inspectOne('codex'),
    opencode: inspectOne('opencode'),
  };
}
```

- [ ] **Step 4: Verificar la corrida real de humo**

Run: `node docs/research/r0/probes/run.mjs --provider claude-code --env smoke`
Expected: JSON con `probes.detachedSurvival.state: "soportado"` (sandbox Linux permite detached), `renameReplace.state: "soportado"`, y `cliInspection` con al menos un binario en `no-verificable-aquí: binario ausente` (codex/opencode no están instalados acá — ejercita R3.1 con dato real, la corrida NO aborta).
Limpiar: `rm docs/research/r0/evidence/mech-claude-code-smoke-*.json docs/research/r0/evidence/detached-heartbeats-*.log`

- [ ] **Step 5: Commit**

```bash
git add docs/research/r0/probes/lib/
git commit -m "feat(r0): mechanical probes — detached survival, rename-replace, CLI inspection"
```

---

### Task 3: Consolidador con detección de conflictos

_Requirements: R5, R5.1, R5.2_

**Files:**
- Create: `docs/research/r0/probes/consolidate.mjs`

- [ ] **Step 1: Crear `consolidate.mjs`**

```js
#!/usr/bin/env node
// evidence/*.json → capability-matrix.md (design doc R5).
// La matriz SIEMPRE se regenera desde evidencia; nunca se edita a mano.
// Uso: node consolidate.mjs [--evidence-dir <dir>] [--out <archivo>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STATES = ['soportado', 'no-soportado', 'degradado', 'no-verificable-aquí', 'no-certificado'];

// Qué campo de qué clase de evidencia alimenta cada capability de la matriz.
const CELLS = [
  ['detached-survival', 'mech', (j) => j.probes?.detachedSurvival],
  ['rename-replace', 'mech', (j) => j.probes?.renameReplace],
  ['subagent-dispatch', 'agent', (j) => j.exercises?.p1Dispatch],
  ['subagent-parallel', 'agent', (j) => j.exercises?.p1Parallel],
  ['model-override', 'agent', (j) => j.exercises?.p2ModelOverride],
  ['turn-end-live-process', 'agent', (j) => j.exercises?.p3TurnEnd],
  ['worktree-isolation', 'agent', (j) => j.exercises?.p4Worktree],
  ['session-recovery', 'agent', (j) => j.exercises?.p5Recovery],
  ['wait-polling', 'agent', (j) => j.exercises?.p6WaitPolling],
];

function argValue(argv, flag) {
  const i = argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`${flag} requiere un valor`);
  return v;
}

const argv = process.argv.slice(2);
const dir = argValue(argv, '--evidence-dir')
  ? path.resolve(argValue(argv, '--evidence-dir'))
  : fileURLToPath(new URL('../evidence/', import.meta.url));
const out = argValue(argv, '--out')
  ? path.resolve(argValue(argv, '--out'))
  : fileURLToPath(new URL('../capability-matrix.md', import.meta.url));

const runs = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, json: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) }))
  .filter((r) => r.json.schema === 1 && ['mech', 'agent'].includes(r.json.kind));

// (capability, provider, environment) → [{state, file, detail}]
const grouped = new Map();
for (const { file, json } of runs) {
  for (const [cap, kind, pick] of CELLS) {
    if (json.kind !== kind) continue;
    const cell = pick(json);
    if (!cell || !cell.state) continue;
    const state = STATES.includes(cell.state) ? cell.state : 'no-certificado';
    const key = `${cap}|${json.provider}|${json.environment}`;
    const arr = grouped.get(key) ?? [];
    arr.push({ state, file, detail: cell.detail ?? '' });
    grouped.set(key, arr);
  }
}

const cols = [...new Set(runs.map((r) => `${r.json.provider}@${r.json.environment}`))].sort();
const lines = [
  '<!-- GENERADO por probes/consolidate.mjs — NO editar a mano (design doc R5) -->',
  '',
  '# Matriz de capacidades — R0',
  '',
  `Regenerada: corrida de consolidación sobre ${runs.length} archivo(s) de evidencia.`,
  '',
  `| Capability | ${cols.join(' | ')} |`,
  `|---|${cols.map(() => '---').join('|')}|`,
];
for (const [cap] of CELLS) {
  const row = [cap];
  for (const col of cols) {
    const [provider, environment] = col.split('@');
    const entries = grouped.get(`${cap}|${provider}|${environment}`) ?? [];
    if (entries.length === 0) { row.push('—'); continue; }
    const states = [...new Set(entries.map((e) => e.state))];
    if (states.length > 1) {
      // R5.2: el conflicto se muestra, jamás gana en silencio la más reciente.
      row.push(`⚠ CONFLICTO: ${entries.map((e) => `${e.state} (${e.file})`).join(' vs ')}`);
    } else {
      row.push(`${states[0]} ([${entries[0].file}](evidence/${entries[0].file}))`);
    }
  }
  lines.push(`| ${row.join(' | ')} |`);
}
lines.push('', '## CLIs inspeccionados por máquina', '');
for (const { file, json } of runs.filter((r) => r.json.kind === 'mech')) {
  const ci = json.probes?.cliInspection;
  if (!ci) continue;
  for (const bin of ['claude', 'codex', 'opencode']) {
    const hints = (ci[bin]?.modelFlagHints ?? []).join(' · ') || '—';
    lines.push(`- \`${bin}\` @ ${json.provider}@${json.environment}: ${ci[bin]?.state} · flags de modelo: ${hints} · ([${file}](evidence/${file}))`);
  }
}
fs.writeFileSync(out, lines.join('\n') + '\n');
process.stdout.write(`${out}\n`);
```

- [ ] **Step 2: Verificar el caso de conflicto fabricado (R5.2) ANTES de confiar en la matriz**

```bash
T=$(mktemp -d)
cat > $T/agent-codex-owner-mac-A.json <<'EOF'
{"schema":1,"kind":"agent","provider":"codex","environment":"owner-mac","exercises":{"p4Worktree":{"state":"soportado","detail":"run A"}}}
EOF
cat > $T/agent-codex-owner-mac-B.json <<'EOF'
{"schema":1,"kind":"agent","provider":"codex","environment":"owner-mac","exercises":{"p4Worktree":{"state":"no-soportado","detail":"run B"}}}
EOF
node docs/research/r0/probes/consolidate.mjs --evidence-dir $T --out $T/matrix.md
grep -c "CONFLICTO" $T/matrix.md
grep -c "GENERADO" $T/matrix.md
rm -rf $T
```
Expected: ambos `grep -c` devuelven ≥1 — el conflicto se muestra con sus dos corridas y el marcador de generado está presente (R5, R5.2).

- [ ] **Step 3: Verificar caso sin conflicto** — repetir con un solo JSON: la celda muestra `soportado` con link a su evidencia (R5.1), sin la palabra CONFLICTO.

- [ ] **Step 4: Commit**

```bash
git add docs/research/r0/probes/consolidate.mjs
git commit -m "feat(r0): evidence consolidator with explicit conflict surfacing"
```

---

### Task 4: AGENT-PROTOCOL.md

_Requirements: R4_

**Files:**
- Create: `docs/research/r0/AGENT-PROTOCOL.md`

- [ ] **Step 1: Crear el protocolo.** Contenido completo:

````markdown
# Protocolo de agente — R0 (clase 2: hechos del harness)

Para el agente de CADA sesión de provider (Claude Code / Codex / OpenCode).
Regla central (design doc R4): **la verdad queda en archivos**. Toda respuesta
sin artefacto que la respalde se registra `no-certificado` — nunca `soportado`.

Preparación: `STAMP=$(date -u +%Y%m%dT%H%M%SZ)`; los artefactos van en
`docs/research/r0/evidence/` con prefijo `p<N>-<provider>-<env>-$STAMP`.

## P1 — Despacho y paralelismo de subagentes
1. Despachá DOS subagentes a la vez (si tu harness lo permite), cada uno con esta instrucción exacta: "Durante 20 segundos, cada ~1s, agregá una línea `$(date +%s%3N)` al archivo `<evidence>/p1-<provider>-<env>-<STAMP>-<a|b>.log`, luego terminá".
2. Verdad: si existen ambos logs y sus rangos de timestamps se SOLAPAN, hay paralelismo real. Si solo se pudo despachar de a uno, `p1Parallel: no-soportado` y `p1Dispatch: soportado`. Si no hay despacho de subagentes, ambos `no-soportado`.

## P2 — Override de modelo por despacho
1. Despachá un subagente pidiéndole modelo distinto al de la sesión (si tu harness expone esa opción) con la instrucción: "Escribí el identificador exacto del modelo bajo el que corrés en `<evidence>/p2-<provider>-<env>-<STAMP>.txt`".
2. Verdad: el archivo con un identificador distinto al de la sesión ⇒ `soportado`. Sin opción de modelo en el despacho ⇒ `no-soportado`. El subagente no conoce su modelo ⇒ `no-certificado` con nota.

## P3 — Turno que termina con proceso vivo
1. Lanzá detached: `node -e 'const fs=require("fs");const f=process.argv[1];const end=Date.now()+180000;(function t(){fs.appendFileSync(f,Date.now()+"\n");if(Date.now()<end)setTimeout(t,1000)})()' <evidence>/p3-<provider>-<env>-<STAMP>.log & disown` (o `spawn` detached equivalente).
2. Registrá el timestamp actual en `p3-<...>-turnend.txt` y TERMINÁ el turno (respondé y cerrá).
3. En el turno siguiente: contá heartbeats posteriores al timestamp del corte. ≥30s de continuidad ⇒ `soportado`; se cortó al terminar el turno ⇒ `no-soportado`; el harness no permite reconsultar ⇒ `no-certificado`.

## P4 — Worktree
1. `git worktree add /tmp/r0-wt-$STAMP HEAD` → escribí un archivo dentro del worktree → verificá con `git -C <repo> status --short` que el árbol principal NO lo ve → `git worktree remove --force /tmp/r0-wt-$STAMP`.
2. Guardá la transcripción de comandos+salidas en `p4-<provider>-<env>-<STAMP>.txt`. Todo ok ⇒ `soportado`; `git worktree` no disponible o el harness lo bloquea ⇒ `no-soportado` con el error capturado.

## P5 — Recuperación post-interrupción
1. Escribí `p5-<provider>-<env>-<STAMP>-marker.json` con `{"next_action":"escribir p5-resumed con este mismo stamp"}`. Cerrá la sesión o el turno (en Fase B del dueño: cerrá la app/CLI de verdad).
2. En sesión/turno NUEVO, sin memoria del anterior: encontrá el marker SOLO leyendo `evidence/`, ejecutá su `next_action` (crear `p5-<...>-resumed.txt` con el stamp). Ambos archivos con el mismo stamp ⇒ `soportado` (sesión real cerrada) o `degradado` (solo cambio de turno — anotalo).

## P6 — Espera/polling
Describí el mecanismo de espera de tu harness (¿notificaciones de background? ¿polling? ¿sleep bloqueado?) y respaldalo con el artefacto de P3 (quién te despertó y cómo). Sin artefacto posible ⇒ `no-certificado` con nota — es informativo.

## Formulario final
Escribí `evidence/agent-<provider>-<env>-<STAMP>.json`:

```json
{
  "schema": 1,
  "kind": "agent",
  "provider": "<claude-code|codex|opencode>",
  "environment": "<sandbox-remote|owner-mac|...>",
  "date": "<ISO>",
  "harnessVersion": "<lo que tu CLI/harness reporte>",
  "exercises": {
    "p1Dispatch":      { "state": "…", "detail": "…", "artifacts": ["p1-…-a.log", "p1-…-b.log"] },
    "p1Parallel":      { "state": "…", "detail": "rango A ∩ rango B", "artifacts": ["…"] },
    "p2ModelOverride": { "state": "…", "detail": "…", "artifacts": ["p2-….txt"] },
    "p3TurnEnd":       { "state": "…", "detail": "N beats post-corte", "artifacts": ["p3-….log", "p3-…-turnend.txt"] },
    "p4Worktree":      { "state": "…", "detail": "…", "artifacts": ["p4-….txt"] },
    "p5Recovery":      { "state": "…", "detail": "sesión-real | solo-turno", "artifacts": ["p5-…-marker.json", "p5-…-resumed.txt"] },
    "p6WaitPolling":   { "state": "…", "detail": "mecanismo descrito", "artifacts": [] }
  }
}
```

Estados válidos: `soportado | no-soportado | degradado | no-verificable-aquí | no-certificado`.
Un `state` con `artifacts: []` solo es válido para P6 — en P1–P5, sin artefacto ⇒ `no-certificado`.
````

- [ ] **Step 2: Verificar completitud del protocolo**

Run: `grep -c '^## P' docs/research/r0/AGENT-PROTOCOL.md` → Expected: `6`.
Run: `grep -c 'no-certificado' docs/research/r0/AGENT-PROTOCOL.md` → Expected: ≥3 (la regla R4 está presente en la cabecera, en el formulario y en la regla final). *(Proxy de grep — la fidelidad semántica la audita el spec-review del task.)*

- [ ] **Step 3: Commit**

```bash
git add docs/research/r0/AGENT-PROTOCOL.md
git commit -m "docs(r0): agent protocol P1-P6 with file-based ground truth"
```

---

### Task 5: RUNBOOK.md para la Fase B

_Requirements: R8, R10_

**Files:**
- Create: `docs/research/r0/RUNBOOK.md`

- [ ] **Step 1: Crear el runbook.** Contenido completo:

````markdown
# RUNBOOK — Fase B (corridas del dueño)

Objetivo: completar las filas `codex@owner-mac` y `opencode@owner-mac` de la
matriz (obligatorias — design doc R10) y, opcional, `claude-code@owner-mac`.
Windows está fuera de alcance (decisión de diseño, R8). Cada corrida son
minutos, no horas.

## Por cada provider (Codex primero, luego OpenCode)

1. Abrí una sesión del provider sobre este repo, rama
   `claude/agentic-workflow-awm-issues-dqka6l`, actualizada (`git pull`).
2. Sondas mecánicas — pedile al agente (o corrélo vos):
   `node docs/research/r0/probes/run.mjs --provider codex --env owner-mac`
   (ajustá `--provider` y `--env` según corresponda; `--env` es una etiqueta
   libre estable — usá siempre la misma para tu Mac).
3. Protocolo de agente — decile al agente:
   "Ejecutá `docs/research/r0/AGENT-PROTOCOL.md` de punta a punta y escribí el
   formulario final". P5 hacelo en serio: cerrá la sesión/app de verdad y
   retomá en una nueva.
4. Commiteá TODO lo nuevo bajo `docs/research/r0/evidence/` y pusheá la rama:
   `git add docs/research/r0/evidence/ && git commit -m "evidence(r0): <provider>@owner-mac" && git push`

## Al terminar los dos (o tres) providers

Avisá en la sesión de Claude Code (o en el issue #20): "Fase B lista" —
la Fase C consolida, redacta el informe y te lo trae a validación (R9).

## Si algo falla

No arregles el kit acá: anotá el error como comentario en el issue #20 con el
comando exacto y su salida. El kit se corrige en la sesión de desarrollo y
re-corres solo lo afectado (las corridas se acumulan, nada se pisa).
````

- [ ] **Step 2: Verificar**

Run: `grep -c 'owner-mac' docs/research/r0/RUNBOOK.md` → Expected: ≥3.
Run: `grep -c 'Windows' docs/research/r0/RUNBOOK.md` → Expected: ≥1 (declaración R8). *(Proxy — la revisión del task confirma el contenido.)*

- [ ] **Step 3: Commit**

```bash
git add docs/research/r0/RUNBOOK.md
git commit -m "docs(r0): phase B runbook for owner runs"
```

---

### Task 6: Corrida mecánica real de Fase A

_Requirements: R2, R10_

**Files:**
- Create: `docs/research/r0/evidence/mech-claude-code-sandbox-remote-*.json` (generado)

- [ ] **Step 1:** Run: `node docs/research/r0/probes/run.mjs --provider claude-code --env sandbox-remote`
- [ ] **Step 2:** Verificar el JSON: `kind: "mech"`, fingerprint completo, tres sondas con estado del enum, `cliInspection.claude` con lo que el sandbox tenga y codex/opencode presumiblemente `binario ausente` (dato real, no error).
- [ ] **Step 3: Commit**

```bash
git add docs/research/r0/evidence/
git commit -m "evidence(r0): mechanical run claude-code@sandbox-remote"
```

---

### Task 7: P1 + P2 en este harness — **Ejecutor: controlador inline**

_Requirements: R4, R10_

**Files:**
- Create: `docs/research/r0/evidence/p1-*.log`, `p2-*.txt` (artefactos reales)

- [ ] **Step 1:** Ejecutar P1 del protocolo tal como está escrito (dos subagentes heartbeat, 20s). Verificar solapamiento de rangos con los timestamps de ambos logs.
- [ ] **Step 2:** Ejecutar P2 (despacho con modelo distinto; este harness expone `model` en el despacho — el artefacto decide, no la doc).
- [ ] **Step 3:** Commit de artefactos: `git add docs/research/r0/evidence/ && git commit -m "evidence(r0): P1-P2 claude-code@sandbox-remote"`

---

### Task 8: P3 en este harness (corte de turno real) — **Ejecutor: controlador inline**

_Requirements: R4_

**Files:**
- Create: `docs/research/r0/evidence/p3-*.log`, `p3-*-turnend.txt`

- [ ] **Step 1:** Lanzar el writer detached de P3 (180s), registrar el timestamp de corte, programar la reanudación (`send_later` a 2–3 min) y TERMINAR el turno de verdad.
- [ ] **Step 2 (turno siguiente):** Contar heartbeats posteriores al corte; estado según el protocolo; commit.

---

### Task 9: P4 + P5 (proxy honesto) en este harness — **Ejecutor: controlador inline**

_Requirements: R4_

**Files:**
- Create: `docs/research/r0/evidence/p4-*.txt`, `p5-*-marker.json`, `p5-*-resumed.txt`

- [ ] **Step 1:** P4 completo (worktree add/aislar/remove) con transcripción.
- [ ] **Step 2:** P5 en su variante sandbox: el "contexto nuevo" es un subagente fresco SIN briefing que debe encontrar el marker leyendo solo `evidence/` y ejecutar su `next_action`. Registrar estado `degradado` con detalle `solo-turno/subagente-fresco — sesión real cerrada queda para Fase B` (honestidad del proxy, R4).
- [ ] **Step 3:** Escribir el formulario `agent-claude-code-sandbox-remote-<STAMP>.json` completo (P1–P6) y commitear.

---

### Task 10: Análisis sandbox-only

_Requirements: R6_

**Files:**
- Create: `docs/research/r0/analysis/sensor-packs.md`
- Create: `docs/research/r0/analysis/ledger-schema.md`
- Create: `docs/research/r0/analysis/cli-conventions.md`
- Create: `docs/research/r0/analysis/runner-linux.md`

- [ ] **Step 1:** `sensor-packs.md` — leer `/home/user/awm-baseline-registry/sensor-packs/` (estructura real de `generic/` y `js-ts/`): ¿qué archivos definen cada pack? ¿dónde encajaría un "set de referencia de clases de defecto" sin rediseño? Enumerar la estructura observada con paths reales y la respuesta razonada.
- [ ] **Step 2:** `ledger-schema.md` — contra `cli/src/core/ledger/types.ts` real: ¿bastan `class`/`signature`/`ref`/`desc` para mapear un cluster convergente a una clase de defecto con/sin sensor? ¿Qué vocabulario falta, si falta? Citar el enum real de `class` y el caso real del cluster de indentación (archivado en `.awm/ledger/archive/`).
- [ ] **Step 3:** `cli-conventions.md` — convenciones relevantes para la pata CLI de R2/R3 del brief: estructura de comandos (`cli/src/commands/`), patrón de tests (tmpdirs, HOME override), reglas de CONSTITUTION que aplican (args, enums, shape validation).
- [ ] **Step 4:** `runner-linux.md` — con la evidencia de las sondas de este sandbox: qué garantiza Linux aquí (detached, rename) y qué preguntas quedan abiertas para macOS (se completan con la corrida del dueño).
- [ ] **Step 5:** Verificar: cada archivo cita ≥1 path real del repo correspondiente (los análisis anclan en código real, no en memoria). Commit: `git add docs/research/r0/analysis/ && git commit -m "docs(r0): sandbox-only analyses — packs, ledger, CLI, runner"`

---

### Task 11: Matriz real de Fase A + cierre de fase

_Requirements: R5, R5.1, R10_

- [ ] **Step 1:** Run: `node docs/research/r0/probes/consolidate.mjs` → `capability-matrix.md` regenerada solo desde la evidencia real commiteada.
- [ ] **Step 2:** Verificar: columna única `claude-code@sandbox-remote` poblada; marcador GENERADO presente; cada celda con link a evidencia (R5.1); cero conflictos esperados.
- [ ] **Step 3:** Commit + push. La rama queda lista para la Fase B del dueño (el RUNBOOK es el estado completo — sin deuda entre fases).

```bash
git add docs/research/r0/capability-matrix.md
git commit -m "evidence(r0): phase A matrix — claude-code@sandbox-remote"
git push
```

---

### Task 12 (condicionada a Fase B): Consolidación final

_Requirements: R5.2, R10_

- [ ] **Step 1: Gate de evidencia.** `ls docs/research/r0/evidence/ | grep -c 'codex-'` y `grep -c 'opencode-'` → si alguno es 0, **BLOCKED**: reportar "esperando evidencia de Fase B (dueño)" y detener el ciclo aquí — corte legítimo, no fallo.
- [ ] **Step 2:** Reconsolidar; revisar conflictos (si los hay, se muestran — R5.2); commit de la matriz completa.

### Task 13 (condicionada a Fase B): report.md

_Requirements: R7, R7.1, R8, R10_

- [ ] **Step 1:** Redactar `docs/research/r0/report.md` con TODAS las secciones de R7: estado real verificado (desde la matriz + análisis), mapeo conceptual→real, **Contradicciones con el brief** (aunque esté vacía, la sección existe y dice "ninguna encontrada" — R7.1), especificación reproducible de fixtures (job largo, sin output, `orphaned`, fingerprint — especificación, no código), plan técnico provider-neutral para R1–R5, declaración de corridas existentes (R10) y de Windows fuera de alcance (R8).
- [ ] **Step 2:** Verificar secciones: `grep -c '^## ' docs/research/r0/report.md` ≥ 6 y `grep -c 'Contradicciones' report.md` ≥ 1. Commit + push.

### Task 14: Validación del dueño — **gate externo, siempre interactivo**

_Requirements: R9_

- [ ] **Step 1:** Presentar `report.md` al dueño; registrar su validación (o sus objeciones) como comentario en el issue #20. R0 NO está completo sin este paso — el modo desatendido no lo salta (autoridad externa).

---

## Traceability matrix

| Req | Task(s) | Test(s) / verificación |
|---|---|---|
| R1 | T1 | Estructura bajo `docs/research/r0/` (Step 6 de T1 commitea solo ese árbol); ninguna task toca `cli/` ni configs — auditable por `git diff --stat` del branch |
| R2 | T1, T6 | T1 Step 5: JSON estampado creado con args válidos; T6 Step 2: fingerprint + tres sondas en corrida real |
| R2.1 | T1, T2 | Revisión de imports: solo `node:*` (verificable con `grep -rn "from '" docs/research/r0/probes/ \| grep -v node:` → vacío) |
| R2.2 | T1 | Step 5: dos corridas ⇒ dos archivos distintos |
| R3 | T2 | Step 4: tres sondas con estado real en sandbox |
| R3.1 | T2, T6 | Step 4/2: codex/opencode ausentes ⇒ `no-verificable-aquí: binario ausente`, corrida completa exit 0 |
| R4 | T4, T7, T8, T9 | T4 Step 2 (greps proxy + spec-review); T7–T9: artefactos reales con la regla no-certificado aplicada en P5 |
| R5 | T3, T11 | T3 Step 2: marcador GENERADO; T11: matriz solo-desde-evidencia |
| R5.1 | T3, T11 | T3 Step 3: celda con link; T11 Step 2: celdas clavadas por (provider, env) |
| R5.2 | T3, T12 | T3 Step 2: conflicto fabricado visible con ambas corridas |
| R6 | T10 | Step 5: 4 análisis, cada uno anclado a paths reales |
| R7, R7.1 | T13 | Step 2: secciones presentes incl. Contradicciones (grep proxy + validación del dueño en T14) |
| R8 | T5, T13 | T5 Step 2: declaración Windows; T13: repetida en el informe |
| R9 | T14 | Comentario de validación del dueño en #20 — sin proxy automatizable, es el gate humano |
| R10 | T5, T6, T11, T12, T13 | Corridas obligatorias: T6/T11 (fila A), T12 gate codex+opencode, T13 declara las existentes |

## Analyze gate

Los 15 IDs de requirement tienen ≥1 task y ≥1 verificación. Verificaciones por grep están marcadas como proxy con su respaldo humano (spec-review del task o validación del dueño). Ninguna task sin requirement: T1–T14 trazan todas. Cero huérfanos.
