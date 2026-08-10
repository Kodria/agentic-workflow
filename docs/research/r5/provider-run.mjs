#!/usr/bin/env node
// R5 Task 16 Step 2 — runner provider-neutral para certificar los tracks paralelos sobre
// providers REALES.
//
// **La propiedad que hace útil a este runner: ningún veredicto sale de lo que el agente
// dice haber hecho.** El agente ejecuta los tres ejercicios; el runner después LEE el
// journal durable que quedó en el WORKDIR y deriva `pass`/`fail` de ahí. Un agente que
// reporte "bootstrap ok" sin haberlo corrido produce un `fail`, porque el journal no
// tiene los eventos. Esto es deliberado: la evidencia de un provider no puede depender de
// la buena fe del provider que se está evaluando.
//
// Modos:
//   --provider P --environment E              prepara el WORKDIR e imprime el comando finalize
//   --finalize --workdir W                    deriva veredictos del journal y escribe la evidencia
//   --provider P --environment E --verify     revalida la evidencia ya escrita
//   --consolidate                             genera provider-matrix.md SOLO desde la evidencia
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const EVIDENCE = path.join(HERE, 'evidence');
const ARTIFACTS = path.join(EVIDENCE, 'artifacts');

/** Combinaciones aceptadas. Enumeradas a propósito: un `--environment` libre dejaría
 *  entrar corridas no reproducibles al gate obligatorio. */
const ACCEPTED = {
    'claude-code': ['sandbox-remote'],
    codex: ['owner-mac', 'vpc-ubuntu'],
};

const BRANCH = 'main';
const TRACKS = ['alpha', 'beta'];

function die(msg) {
    process.stderr.write(`provider-run: ${msg}\n`);
    process.exit(1);
}

function parseArgs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) die(`argumento inesperado: ${a}`);
        const key = a.slice(2);
        if (['verify', 'consolidate', 'finalize'].includes(key)) { out[key] = true; continue; }
        const value = argv[++i];
        if (value === undefined || value.startsWith('--')) die(`--${key} requiere un valor`);
        out[key] = value;
    }
    return out;
}

function assertCombo(provider, environment) {
    if (!Object.hasOwn(ACCEPTED, provider)) die(`provider no aceptado: ${provider} (acepta: ${Object.keys(ACCEPTED).join(', ')})`);
    if (!ACCEPTED[provider].includes(environment)) {
        die(`combinación no aceptada: ${provider}/${environment} (para ${provider}: ${ACCEPTED[provider].join(', ')})`);
    }
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// ---------------------------------------------------------------------------
// Sanitización
// ---------------------------------------------------------------------------

/** Reemplaza el WORKDIR y cualquier home real por placeholders. Se aplica al TEXTO
 *  serializado, no campo por campo: una ruta puede aparecer embebida en un mensaje de
 *  error, y sanitizar solo los campos "conocidos" deja escapar exactamente esos. */
function sanitize(text, workdir) {
    let out = text;
    for (const real of [workdir, fs.existsSync(workdir) ? fs.realpathSync(workdir) : workdir, os.tmpdir(), REPO]) {
        if (real && real.length > 3) out = out.split(real).join('<WORKDIR>');
    }
    // Homes reales en cualquier orden/plataforma, incluso si no son el WORKDIR.
    out = out.replace(/\/Users\/[^/"\s]+/g, '<HOME>').replace(/\/home\/[^/"\s]+/g, '<HOME>')
        .replace(/[A-Za-z]:\\\\?Users\\\\?[^\\"\s]+/g, '<HOME>');
    // Cualquier cosa que se parezca a un secreto no viaja, aunque venga de un log ajeno.
    out = out.replace(/\b(token|secret|password|api[-_]?key)\b\s*[:=]\s*\S+/gi, '$1=<REDACTED>');
    return out;
}

// ---------------------------------------------------------------------------
// Preparación del WORKDIR
// ---------------------------------------------------------------------------

function prepare(provider, environment) {
    const dist = path.join(REPO, 'cli', 'dist', 'src', 'index.js');
    if (!fs.existsSync(dist)) die(`falta el build: correr \`cd cli && npm ci && npm run build\` (no existe ${path.relative(REPO, dist)})`);

    let sourceHead;
    try { sourceHead = git(REPO, ['rev-parse', 'HEAD']).trim(); } catch { die('el repo del CLI no responde `git rev-parse HEAD`'); }
    if (!/^[0-9a-f]{40}$/.test(sourceHead)) die(`sourceHead inesperado: ${sourceHead}`);

    const workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `awm-r5-${provider}-`)));
    const repo = path.join(workdir, 'plan');
    fs.mkdirSync(repo, { recursive: true });

    git(repo, ['init', '-q', '-b', BRANCH]);
    git(repo, ['config', 'user.email', 'r5@awm.test']);
    git(repo, ['config', 'user.name', 'AWM R5']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    // `.awm` ignorado es un PRE-REQUISITO del bootstrap de tracks (C2): sin esto,
    // `addWorktree` descarta el worktree que acaba de crear y la cohorte degrada a serial
    // — el ejercicio mediría la degradación en vez del bootstrap.
    fs.writeFileSync(path.join(repo, '.gitignore'), '.awm/\n');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    for (const t of TRACKS) fs.writeFileSync(path.join(repo, 'src', `${t}.txt`), `${t}-inicial\n`);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-qm', 'seed']);

    const run = {
        schema: 1, provider, environment, sourceHead,
        branch: BRANCH, tracks: TRACKS,
        cli: dist, repo, workdir,
        preparedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(workdir, 'run.json'), JSON.stringify(run, null, 2));
    fs.mkdirSync(path.join(workdir, 'logs'), { recursive: true });

    process.stdout.write([
        `WORKDIR=${workdir}`,
        `REPO=${repo}`,
        `CLI=${dist}`,
        `TRACKS=${TRACKS.join(',')}`,
        '',
        'Ejecutá los tres ejercicios de docs/research/r5/provider-protocol.md dentro de REPO.',
        'Al terminar, ejecutá EXACTAMENTE:',
        '',
        `  node ${path.relative(REPO, path.join(HERE, 'provider-run.mjs'))} --finalize --workdir ${workdir}`,
        '',
    ].join('\n'));
}

// ---------------------------------------------------------------------------
// Derivación de veredictos DESDE EL JOURNAL (nunca desde el reporte del agente)
// ---------------------------------------------------------------------------

function readJournal(repo) {
    const dir = path.join(repo, '.awm', 'journal', BRANCH);
    const statePath = path.join(dir, 'state.json');
    const eventsPath = path.join(dir, 'events.jsonl');
    if (!fs.existsSync(statePath)) return { state: null, events: [], dir };
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const events = fs.existsSync(eventsPath)
        ? fs.readFileSync(eventsPath, 'utf8').split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l))
        : [];
    return { state: state.state ?? state, events, dir };
}

/** Los tres ejercicios, cada uno con su criterio derivado del journal REAL. Cada criterio
 *  devuelve `{ verdict, detail }` — un `fail` siempre explica qué faltó, para que la
 *  siguiente corrida sepa qué reintentar en vez de volver a adivinar. */
function assess(state, events) {
    const out = {};

    // 1. Bootstrap: los dos tracks llegaron a ARMED y la cohorte a ACTIVE.
    const armed = new Set(events.filter((e) => e.kind === 'track-armed-or-blocked').map((e) => e.trackId));
    const reachedActive = events.some((e) => e.effect === 'activate-cohort')
        || ['ACTIVE', 'JOINING', 'FINAL_INTERLOCK', 'COMPLETE'].includes(state?.cohortPhase);
    out.bootstrap = TRACKS.every((t) => armed.has(t)) && reachedActive
        ? { verdict: 'pass', detail: `ARMED: ${[...armed].sort().join(',')}; cohorte activada` }
        : { verdict: 'fail', detail: `ARMED observados: ${[...armed].sort().join(',') || 'ninguno'}; cohorte activada: ${reachedActive}` };

    // 2. Recovery: tras el SIGKILL y el relanzamiento, UN solo spawn por track. Más de uno
    //    significa que el restart duplicó un supervisor — exactamente lo que C11 prohíbe.
    const spawns = {};
    for (const e of events.filter((e) => e.kind === 'track-supervisor-intent')) {
        spawns[e.trackId] = (spawns[e.trackId] ?? 0) + 1;
    }
    //    La prueba de que hubo un relanzamiento no es una marca que escriba el agente —
    //    eso sería el auto-reporte que este runner existe para no creer. Es el journal
    //    mismo: cada `awm watch` que arranca abre su propia generación de controller, así
    //    que ≥2 generaciones es evidencia durable de que un segundo proceso tomó el relevo.
    const generations = (state?.generations ?? []).length;
    const singleSpawn = TRACKS.every((t) => spawns[t] === 1);
    out.recovery = generations >= 2 && singleSpawn
        ? { verdict: 'pass', detail: `${generations} generaciones de controller y un solo supervisorIntent por track: ${JSON.stringify(spawns)}` }
        : { verdict: 'fail', detail: `generaciones de controller: ${generations} (se exigen ≥2, prueba del relanzamiento); spawns por track: ${JSON.stringify(spawns)} (se exige exactamente 1 por track)` };

    // 3. Join: cohorte COMPLETE, todos los tracks JOINED, y UN solo job de integración
    //    final (C3/C4: el comando canónico corre una vez sobre el HEAD final, no una vez
    //    por track).
    const tracks = state?.tracks ?? [];
    const allJoined = tracks.length === TRACKS.length && tracks.every((t) => t.phase === 'JOINED');
    const complete = state?.cohortPhase === 'COMPLETE';
    const integrationRuns = Object.values(state?.jobs ?? {}).filter((j) => j.id === state?.finalIntegrationJobId).length;
    out.join = complete && allJoined && integrationRuns === 1
        ? { verdict: 'pass', detail: `COMPLETE con ${tracks.length} tracks JOINED y 1 job de integración final` }
        : { verdict: 'fail', detail: `cohortPhase=${state?.cohortPhase}; JOINED=${tracks.filter((t) => t.phase === 'JOINED').length}/${TRACKS.length}; jobs de integración final=${integrationRuns}` };

    out.finalIntegrationRuns = integrationRuns;
    return out;
}

function finalize(workdir) {
    const runPath = path.join(workdir, 'run.json');
    if (!fs.existsSync(runPath)) die(`no hay run.json en ${workdir} — ¿se corrió la preparación?`);
    const run = JSON.parse(fs.readFileSync(runPath, 'utf8'));
    assertCombo(run.provider, run.environment);

    const { state, events } = readJournal(run.repo);
    if (state === null) die(`no hay journal en ${path.join(run.repo, '.awm/journal', BRANCH)} — los ejercicios no se ejecutaron`);

    const ex = assess(state, events);
    const verdicts = { bootstrap: ex.bootstrap.verdict, recovery: ex.recovery.verdict, join: ex.join.verdict, finalIntegrationRuns: ex.finalIntegrationRuns };
    const result = ['bootstrap', 'recovery', 'join'].every((k) => ex[k].verdict === 'pass') && ex.finalIntegrationRuns === 1 ? 'pass' : 'fail';

    // Artefactos: el journal completo, sanitizado. Es lo que permite que otro humano
    // reaudite la corrida sin confiar en este runner tampoco.
    const slug = `${run.provider}-${run.environment}`;
    const outDir = path.join(ARTIFACTS, slug);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const artifacts = [];
    for (const [name, text] of [
        ['state.json', JSON.stringify(state, null, 2)],
        ['events.jsonl', events.map((e) => JSON.stringify(e)).join('\n') + '\n'],
    ]) {
        fs.writeFileSync(path.join(outDir, name), sanitize(text, run.workdir));
        artifacts.push(path.posix.join('evidence', 'artifacts', slug, name));
    }

    const evidence = {
        schema: 1,
        provider: run.provider,
        environment: run.environment,
        result,
        exercises: verdicts,
        details: { bootstrap: ex.bootstrap.detail, recovery: ex.recovery.detail, join: ex.join.detail },
        sourceHead: run.sourceHead,
        commands: [
            `node dist/src/index.js watch --init`,
            ...TRACKS.map((t) => `node dist/src/index.js track add ${t}`),
            `node dist/src/index.js watch`,
            ...TRACKS.map((t) => `node dist/src/index.js track join ${t}`),
            `node dist/src/index.js track status`,
        ],
        artifacts,
        finalizedAt: new Date().toISOString(),
    };

    fs.mkdirSync(EVIDENCE, { recursive: true });
    const file = path.join(EVIDENCE, `${slug}.json`);
    fs.writeFileSync(file, sanitize(JSON.stringify(evidence, null, 2), run.workdir) + '\n');

    process.stdout.write(`${result === 'pass' ? 'PASS' : 'FAIL'} ${path.relative(REPO, file)}\n`);
    for (const k of ['bootstrap', 'recovery', 'join']) process.stdout.write(`  ${k}: ${ex[k].verdict} — ${ex[k].detail}\n`);
    // Exit != 0 en fail: un ejercicio que no pasó nunca debe leerse como corrida exitosa
    // solo porque el archivo se escribió.
    if (result !== 'pass') process.exit(1);
}

function verify(provider, environment) {
    assertCombo(provider, environment);
    const file = path.join(EVIDENCE, `${provider}-${environment}.json`);
    if (!fs.existsSync(file)) die(`no existe ${path.relative(REPO, file)} — correr --finalize primero`);
    const x = JSON.parse(fs.readFileSync(file, 'utf8'));
    const problems = [];
    if (x.schema !== 1) problems.push('schema != 1');
    if (x.provider !== provider || x.environment !== environment) problems.push('provider/environment no coinciden con el nombre del archivo');
    if (x.result !== 'pass') problems.push(`result=${x.result}`);
    for (const k of ['bootstrap', 'recovery', 'join']) if (x.exercises?.[k] !== 'pass') problems.push(`${k}=${x.exercises?.[k]}`);
    if (x.exercises?.finalIntegrationRuns !== 1) problems.push(`finalIntegrationRuns=${x.exercises?.finalIntegrationRuns}`);
    if (!/^[0-9a-f]{40}$/.test(x.sourceHead ?? '')) problems.push('sourceHead no es un SHA');
    for (const p of x.artifacts ?? []) if (!fs.existsSync(path.resolve(HERE, p))) problems.push(`artefacto ausente: ${p}`);
    if (/(?:token|secret|password|\/Users\/[^/]+|\/home\/[^/]+)/i.test(JSON.stringify(x))) problems.push('la evidencia contiene rutas de home o algo que parece un secreto');
    if (problems.length > 0) die(`evidencia inválida:\n  - ${problems.join('\n  - ')}`);
    process.stdout.write(`OK ${path.relative(REPO, file)}\n`);
}

// ---------------------------------------------------------------------------
// Consolidación — la matriz sale SOLO de la evidencia
// ---------------------------------------------------------------------------

const ROWS = [
    ['bootstrap', (x) => x.exercises.bootstrap === 'pass'],
    ['crash recovery', (x) => x.exercises.recovery === 'pass'],
    ['worktree join', (x) => x.exercises.join === 'pass'],
];

function consolidate() {
    const columns = [];
    for (const [provider, envs] of Object.entries(ACCEPTED)) {
        const found = envs.map((e) => path.join(EVIDENCE, `${provider}-${e}.json`)).find((f) => fs.existsSync(f));
        columns.push({
            provider,
            label: found ? `${provider} ${JSON.parse(fs.readFileSync(found, 'utf8')).environment}` : `${provider} (sin evidencia)`,
            data: found ? JSON.parse(fs.readFileSync(found, 'utf8')) : null,
        });
    }

    let certified = true;
    const lines = [
        '<!-- GENERADO por provider-run.mjs --consolidate. No editar a mano: se regenera desde',
        '     docs/research/r5/evidence/*.json y cualquier edición manual se pierde. -->',
        '# R5 · matriz de providers (solo desde evidencia)',
        '',
        `| Capability | ${columns.map((c) => c.label).join(' | ')} |`,
        `|---|${columns.map(() => '---').join('|')}|`,
    ];
    for (const [name, ok] of ROWS) {
        const cells = columns.map((c) => {
            // La ausencia NUNCA se escribe como `supported`: sin evidencia, `not-certified`.
            if (c.data === null) { certified = false; return 'not-certified'; }
            if (!ok(c.data)) { certified = false; return 'not-certified'; }
            return 'supported';
        });
        lines.push(`| ${name} | ${cells.join(' | ')} |`);
    }
    // Semántica del gate final: `identical` exige que TODOS los providers con evidencia
    // coincidan en el veredicto de los tres ejercicios y en correr la integración una vez.
    const shapes = columns.map((c) => (c.data === null ? null : JSON.stringify(c.data.exercises)));
    const identical = shapes.every((s) => s !== null && s === shapes[0]);
    if (!identical) certified = false;
    lines.push(`| final gate semantics | ${columns.map(() => (identical ? 'identical' : 'not-certified')).join(' | ')} |`);
    lines.push('');
    lines.push(`Fuente: ${columns.map((c) => (c.data === null ? `${c.provider}: SIN EVIDENCIA` : `${c.provider}@${c.data.sourceHead.slice(0, 12)}`)).join(' · ')}`);
    lines.push('');

    fs.mkdirSync(HERE, { recursive: true });
    fs.writeFileSync(path.join(HERE, 'provider-matrix.md'), lines.join('\n'));
    process.stdout.write(`${certified ? 'CERTIFICADA' : 'NO CERTIFICADA'} docs/research/r5/provider-matrix.md\n`);
    if (!certified) process.exit(1);
}

// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
if (args.consolidate) consolidate();
else if (args.finalize) finalize(args.workdir ?? die('--finalize requiere --workdir'));
else if (args.verify) verify(args.provider ?? die('--verify requiere --provider'), args.environment ?? die('--verify requiere --environment'));
else if (args.provider !== undefined) { assertCombo(args.provider, args.environment ?? die('--provider requiere --environment')); prepare(args.provider, args.environment); }
else die('modo requerido: --provider/--environment, --finalize --workdir, --verify, o --consolidate');
